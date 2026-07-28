import {
  BREVO_PROVIDER_KEY,
  DomainError,
  InstallationStep,
  parseProviderKey,
  type InstallationStatus,
  type Principal,
} from "@unimailbox/contracts";
import { runtimePolicy, type RuntimeConfig } from "@unimailbox/config";
import type { SetupSession, SetupUseCases } from "../../http/router";
import type { HealthService } from "../maintenance";
import { hashRefreshToken } from "../identity";
import type { InstallationService } from "./index";
import type { IdentityApplicationService } from "../identity/application";
import type { CredentialCipher } from "../../platform/crypto";
import type { ProviderRegistry } from "../../integrations/providers";
import { readSecretBinding, type SecretBinding } from "../../platform/config";

interface StoredSetupSession {
  id: string;
  csrfToken: string;
  expiresAt: string;
  kind?: "setup" | "repair";
}

interface StoredOauthState {
  setupSessionId: string;
  codeVerifier: string;
  redirectUri: string;
}

function base64Url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function timingSafeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

function cookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie") ?? "";
  for (const entry of header.split(";")) {
    const [key, ...value] = entry.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}

export class SetupApplicationService implements SetupUseCases {
  constructor(
    private readonly kv: KVNamespace,
    private readonly installation: InstallationService,
    private readonly health: Pick<HealthService, "check">,
    private readonly runtimeConfig: RuntimeConfig,
    private readonly database: D1Database,
    private readonly identity: IdentityApplicationService,
    private readonly credentials: CredentialCipher,
    private readonly providers: ProviderRegistry,
    private readonly oauth: {
      clientId?: SecretBinding;
      clientSecret?: SecretBinding;
      scopes?: string;
    },
  ) {}

  async claim(token: string, request: Request): Promise<SetupSession> {
    if (await this.kv.get("setup:installation-token-invalidated")) {
      throw new DomainError("SETUP_NOT_FOUND", "Setup is not available", 404);
    }
    if (!timingSafeEqual(token, this.runtimeConfig.INSTALLATION_TOKEN)) {
      throw new DomainError(
        "INSTALLATION_TOKEN_INVALID",
        "The installation token is invalid",
        401,
      );
    }

    const sessionToken = crypto.randomUUID() + crypto.randomUUID();
    const sessionKey = `setup:session:${await hashRefreshToken(sessionToken)}`;
    const expiresAt = new Date(
      Date.now() + runtimePolicy.setupSessionTtlSeconds * 1000,
    ).toISOString();
    const stored: StoredSetupSession = {
      id: crypto.randomUUID(),
      csrfToken: crypto.randomUUID() + crypto.randomUUID(),
      expiresAt,
      kind: "setup",
    };
    await this.kv.put(sessionKey, JSON.stringify(stored), {
      expirationTtl: runtimePolicy.setupSessionTtlSeconds,
    });

    try {
      await this.installation.advance({
        expected: InstallationStep.CLAIM,
        next: InstallationStep.PREFLIGHT,
        requestId: request.headers.get("x-request-id") ?? crypto.randomUUID(),
        verify: async () => undefined,
      });
    } catch (error) {
      await this.kv.delete(sessionKey);
      throw error;
    }

    return {
      token: sessionToken,
      csrfToken: stored.csrfToken,
      expiresAt,
    };
  }

  async requireSession(
    request: Request,
  ): Promise<{ id: string; csrfToken: string; repair?: boolean }> {
    const repairToken = cookie(request, "unimailbox_repair");
    const setupToken = cookie(request, "unimailbox_setup");
    const token = repairToken ?? setupToken;
    if (!token) {
      const status = await this.installation.getStatus();
      if (status.currentStep === InstallationStep.COMPLETE) {
        throw new DomainError("SETUP_NOT_FOUND", "Setup is not available", 404);
      }
      throw new DomainError(
        "SETUP_SESSION_REQUIRED",
        "A valid setup session is required",
        401,
      );
    }
    const value = await this.kv.get(
      `setup:session:${await hashRefreshToken(token)}`,
    );
    if (!value) {
      throw new DomainError(
        "SETUP_SESSION_INVALID",
        "The setup session is invalid or expired",
        401,
      );
    }
    const session = JSON.parse(value) as StoredSetupSession;
    if (new Date(session.expiresAt).getTime() <= Date.now()) {
      throw new DomainError(
        "SETUP_SESSION_INVALID",
        "The setup session is invalid or expired",
        401,
      );
    }
    const csrf = request.headers.get("x-setup-csrf") ?? "";
    if (!timingSafeEqual(csrf, session.csrfToken)) {
      throw new DomainError(
        "SETUP_CSRF_INVALID",
        "The setup request could not be verified",
        403,
      );
    }
    const status = await this.installation.getStatus();
    const repair = session.kind === "repair";
    if (status.currentStep === InstallationStep.COMPLETE && !repair) {
      throw new DomainError("SETUP_NOT_FOUND", "Setup is not available", 404);
    }
    return { id: session.id, csrfToken: session.csrfToken, repair };
  }

  async openRepairSession(
    principal: Principal,
    request: Request,
  ): Promise<SetupSession> {
    if (!principal.permissions.has("settings.manage")) {
      throw new DomainError(
        "PERMISSION_DENIED",
        "Permission settings.manage is required",
        403,
      );
    }
    const status = await this.installation.getStatus();
    if (status.currentStep !== InstallationStep.COMPLETE) {
      throw new DomainError(
        "INSTALLATION_INCOMPLETE",
        "Finish the active setup session before opening repair mode",
        409,
      );
    }
    const token = crypto.randomUUID() + crypto.randomUUID();
    const expiresAt = new Date(
      Date.now() + runtimePolicy.setupSessionTtlSeconds * 1000,
    ).toISOString();
    const stored: StoredSetupSession = {
      id: crypto.randomUUID(),
      csrfToken: crypto.randomUUID() + crypto.randomUUID(),
      expiresAt,
      kind: "repair",
    };
    await this.kv.put(
      `setup:session:${await hashRefreshToken(token)}`,
      JSON.stringify(stored),
      { expirationTtl: runtimePolicy.setupSessionTtlSeconds },
    );
    await this.database
      .prepare(
        `INSERT INTO audit_events (
           id, actor_user_id, action, resource_type, resource_id,
           request_id, metadata_json
         ) VALUES (?, ?, 'installation.repair.opened',
                   'installation', '1', ?, '{}')`,
      )
      .bind(
        crypto.randomUUID(),
        principal.userId,
        request.headers.get("x-request-id") ?? crypto.randomUUID(),
      )
      .run();
    return {
      token,
      csrfToken: stored.csrfToken,
      expiresAt,
    };
  }

  async cloudflareOauthStart(request: Request): Promise<{ url: string }> {
    const session = await this.requireSession(request);
    if (
      !this.oauth.clientId ||
      !this.oauth.clientSecret ||
      !this.oauth.scopes
    ) {
      throw new DomainError(
        "CLOUDFLARE_OAUTH_NOT_CONFIGURED",
        "This distribution uses dashboard-assisted Cloudflare setup",
        404,
      );
    }
    const requestUrl = new URL(request.url);
    if (
      requestUrl.protocol !== "https:" &&
      requestUrl.hostname !== "localhost"
    ) {
      throw new DomainError(
        "CLOUDFLARE_OAUTH_HTTPS_REQUIRED",
        "Cloudflare OAuth requires an HTTPS deployment",
        400,
      );
    }
    const state = base64Url(crypto.getRandomValues(new Uint8Array(32)));
    const codeVerifier = base64Url(crypto.getRandomValues(new Uint8Array(48)));
    const challenge = base64Url(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(codeVerifier),
      ),
    );
    const redirectUri = new URL(
      "/api/v1/setup/cloudflare/oauth/callback",
      requestUrl.origin,
    ).toString();
    const stored: StoredOauthState = {
      setupSessionId: session.id,
      codeVerifier,
      redirectUri,
    };
    await this.kv.put(`setup:oauth:${state}`, JSON.stringify(stored), {
      expirationTtl: 600,
    });
    const authorization = new URL("https://dash.cloudflare.com/oauth2/auth");
    authorization.searchParams.set(
      "client_id",
      await readSecretBinding(this.oauth.clientId),
    );
    authorization.searchParams.set("response_type", "code");
    authorization.searchParams.set("redirect_uri", redirectUri);
    authorization.searchParams.set("scope", this.oauth.scopes);
    authorization.searchParams.set("state", state);
    authorization.searchParams.set("code_challenge", challenge);
    authorization.searchParams.set("code_challenge_method", "S256");
    return { url: authorization.toString() };
  }

  async cloudflareOauthCallback(request: Request): Promise<URL> {
    const callback = new URL(request.url);
    const state = callback.searchParams.get("state") ?? "";
    const code = callback.searchParams.get("code") ?? "";
    const storedValue = await this.kv.get(`setup:oauth:${state}`);
    if (
      !storedValue ||
      !code ||
      !this.oauth.clientId ||
      !this.oauth.clientSecret
    ) {
      throw new DomainError(
        "CLOUDFLARE_OAUTH_CALLBACK_INVALID",
        "The Cloudflare authorization response is invalid or expired",
        400,
      );
    }
    await this.kv.delete(`setup:oauth:${state}`);
    const stored = JSON.parse(storedValue) as StoredOauthState;
    if (new URL(stored.redirectUri).origin !== callback.origin) {
      throw new DomainError(
        "CLOUDFLARE_OAUTH_ORIGIN_INVALID",
        "The Cloudflare authorization origin does not match",
        400,
      );
    }
    const clientId = this.oauth.clientId
      ? await readSecretBinding(this.oauth.clientId)
      : "";
    const clientSecret = this.oauth.clientSecret
      ? await readSecretBinding(this.oauth.clientSecret)
      : "";
    const tokenResponse = await fetch(
      "https://dash.cloudflare.com/oauth2/token",
      {
        method: "POST",
        headers: {
          authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: stored.redirectUri,
          code_verifier: stored.codeVerifier,
        }),
      },
    );
    if (!tokenResponse.ok) {
      throw new DomainError(
        "CLOUDFLARE_OAUTH_EXCHANGE_FAILED",
        "Cloudflare did not accept the authorization code",
        502,
      );
    }
    const tokens = await tokenResponse.json<{
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
      token_type: string;
    }>();
    const credentialId = crypto.randomUUID();
    await this.database.batch([
      this.database
        .prepare(
          `INSERT INTO encrypted_credentials (
             id, encrypted_payload, encryption_version
           ) VALUES (?, ?, 1)`,
        )
        .bind(
          credentialId,
          await this.credentials.encrypt({
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token ?? "",
            tokenType: tokens.token_type,
            scope: tokens.scope ?? "",
            expiresAt: String(Date.now() + (tokens.expires_in ?? 3600) * 1000),
          }),
        ),
      this.database
        .prepare(
          `UPDATE installation_state
           SET cloudflare_credential_id = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = 1`,
        )
        .bind(credentialId),
    ]);
    const destination = new URL("/setup", callback.origin);
    destination.searchParams.set("cloudflare", "connected");
    return destination;
  }

  async preflight(_request: Request): Promise<unknown> {
    const health = await this.health.check();
    const migration = await this.database
      .prepare(
        `SELECT COUNT(*) AS count
         FROM sqlite_schema
         WHERE type = 'table'
           AND name IN ('users', 'messages', 'installation_state')`,
      )
      .first<{ count: number }>();
    const result = {
      ...health,
      schema: migration?.count === 3 ? "ok" : "missing",
      secrets: {
        installationToken: "ok",
        authSigningKey: "ok",
        credentialEncryptionKey: "ok",
      },
      scheduledTriggers: "declared",
    };
    if (health.status !== "ok" || result.schema !== "ok") {
      throw new DomainError(
        "PREFLIGHT_FAILED",
        "One or more deployment prerequisites are missing",
        503,
        result,
      );
    }
    await this.transition(_request, {
      expected: InstallationStep.PREFLIGHT,
      next: InstallationStep.ADMIN,
      verify: async () => undefined,
    });
    return result;
  }

  async revokeCloudflareOauth(
    principal: Principal,
    request: Request,
  ): Promise<{ revoked: boolean }> {
    if (!principal.permissions.has("settings.manage")) {
      throw new DomainError(
        "PERMISSION_DENIED",
        "Permission settings.manage is required",
        403,
      );
    }
    const credential = await this.database
      .prepare(
        `SELECT ec.id, ec.encrypted_payload
         FROM installation_state state
         JOIN encrypted_credentials ec
           ON ec.id = state.cloudflare_credential_id
         WHERE state.id = 1`,
      )
      .first<{ id: string; encrypted_payload: string }>();
    if (!credential) return { revoked: false };
    const clientId = this.oauth.clientId
      ? await readSecretBinding(this.oauth.clientId)
      : "";
    const clientSecret = this.oauth.clientSecret
      ? await readSecretBinding(this.oauth.clientSecret)
      : "";
    if (!clientId || !clientSecret) {
      throw new DomainError(
        "CLOUDFLARE_OAUTH_NOT_CONFIGURED",
        "The OAuth client is unavailable for token revocation",
        409,
      );
    }
    const secrets = await this.credentials.decrypt(
      credential.encrypted_payload,
    );
    const token = secrets.refreshToken || secrets.accessToken;
    const response = await fetch("https://dash.cloudflare.com/oauth2/revoke", {
      method: "POST",
      headers: {
        authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ token }),
    });
    if (!response.ok) {
      throw new DomainError(
        "CLOUDFLARE_OAUTH_REVOKE_FAILED",
        "Cloudflare did not revoke the OAuth authorization",
        502,
      );
    }
    await this.database.batch([
      this.database
        .prepare(
          `UPDATE installation_state
           SET cloudflare_credential_id = NULL, updated_at = CURRENT_TIMESTAMP
           WHERE id = 1 AND cloudflare_credential_id = ?`,
        )
        .bind(credential.id),
      this.database
        .prepare("DELETE FROM encrypted_credentials WHERE id = ?")
        .bind(credential.id),
      this.database
        .prepare(
          `INSERT INTO audit_events (
             id, actor_user_id, action, resource_type, resource_id,
             request_id, metadata_json
           ) VALUES (?, ?, 'cloudflare.oauth.revoked',
                     'installation', '1', ?, '{}')`,
        )
        .bind(
          crypto.randomUUID(),
          principal.userId,
          request.headers.get("x-request-id") ?? crypto.randomUUID(),
        ),
    ]);
    return { revoked: true };
  }

  async administrator(
    input: { email: string; password: string; displayName: string },
    request: Request,
  ): Promise<unknown> {
    let administrator: { userId: string; recoveryCodes: string[] } | undefined;
    await this.transition(request, {
      expected: InstallationStep.ADMIN,
      next: InstallationStep.CLOUDFLARE,
      verify: async () => {
        const created = await this.identity.createFirstAdministrator(input);
        const recoveryCodes = Array.from({ length: 10 }, () => {
          const compact = crypto.randomUUID().replaceAll("-", "").toUpperCase();
          return `CM-${compact.slice(0, 5)}-${compact.slice(5, 10)}-${compact.slice(10, 15)}`;
        });
        await this.database.batch(
          await Promise.all(
            recoveryCodes.map(async (code) =>
              this.database
                .prepare(
                  `INSERT INTO account_recovery_codes (id, user_id, code_hash)
                   VALUES (?, ?, ?)`,
                )
                .bind(
                  crypto.randomUUID(),
                  created.userId,
                  await hashRefreshToken(code),
                ),
            ),
          ),
        );
        administrator = { ...created, recoveryCodes };
      },
    });
    await this.kv.put("setup:installation-token-invalidated", "true");
    return administrator;
  }

  dashboardLink(input: {
    accountId: string;
    zoneId: string;
    destination: "email-routing" | "dns" | "worker";
  }): URL {
    const segments = {
      "email-routing": "email/routing/routes",
      dns: "dns/records",
      worker: "workers-and-pages",
    } as const;
    const account = encodeURIComponent(input.accountId);
    const zone = encodeURIComponent(input.zoneId);
    const target =
      input.destination === "worker"
        ? `/${account}/${segments.worker}`
        : `/${account}/${zone}/${segments[input.destination]}`;
    return new URL(`https://dash.cloudflare.com${target}`);
  }

  async verifyCloudflare(
    input: {
      accountId: string;
      zoneId: string;
      mode: "dashboard" | "oauth";
    },
    request: Request,
  ): Promise<unknown> {
    let oauthVerification:
      | { zoneName: string; emailRoutingStatus: string }
      | undefined;
    await this.transition(request, {
      expected: InstallationStep.CLOUDFLARE,
      next: InstallationStep.DOMAIN,
      verify: async () => {
        const token = await this.cloudflareAccessToken();
        if (token) {
          const zone = await this.cloudflareApi<{
            name: string;
            account: { id: string };
          }>(token, `/zones/${encodeURIComponent(input.zoneId)}`);
          if (zone.account.id !== input.accountId) {
            throw new DomainError(
              "CLOUDFLARE_ZONE_ACCOUNT_MISMATCH",
              "The selected zone does not belong to the selected account",
              409,
            );
          }
          const routing = await this.cloudflareApi<{
            status?: string;
          }>(token, `/zones/${encodeURIComponent(input.zoneId)}/email/routing`);
          oauthVerification = {
            zoneName: zone.name,
            emailRoutingStatus: routing.status ?? "unknown",
          };
        }
        await this.database
          .prepare(
            `UPDATE installation_state
             SET cloudflare_account_id = ?, cloudflare_zone_id = ?
             WHERE id = 1`,
          )
          .bind(input.accountId, input.zoneId)
          .run();
      },
    });
    return {
      mode: input.mode,
      routingVerification: "pending_inbound_smoke_test",
      ...(oauthVerification ? { oauthVerification } : {}),
    };
  }

  async createDomain(
    input: { name: string },
    request: Request,
  ): Promise<unknown> {
    const domain = {
      id: crypto.randomUUID(),
      name: input.name.trim().toLowerCase(),
    };
    let cloudflareRouting: { dns: string; catchAll: string } | undefined;
    await this.transition(request, {
      expected: InstallationStep.DOMAIN,
      next: InstallationStep.INBOUND_SMOKE_TEST,
      verify: async () => {
        const installation = await this.database
          .prepare(
            `SELECT cloudflare_zone_id FROM installation_state WHERE id = 1`,
          )
          .first<{ cloudflare_zone_id: string | null }>();
        const token = await this.cloudflareAccessToken();
        if (token && installation?.cloudflare_zone_id) {
          const zoneId = encodeURIComponent(installation.cloudflare_zone_id);
          const zone = await this.cloudflareApi<{ name: string }>(
            token,
            `/zones/${zoneId}`,
          );
          if (
            domain.name !== zone.name.toLowerCase() &&
            !domain.name.endsWith(`.${zone.name.toLowerCase()}`)
          ) {
            throw new DomainError(
              "DOMAIN_ZONE_MISMATCH",
              "The managed domain is outside the selected Cloudflare zone",
              409,
            );
          }
          const routing = await this.cloudflareApi<{
            status?: string;
          }>(token, `/zones/${zoneId}/email/routing`);
          if (routing.status !== "ready") {
            await this.cloudflareApi(
              token,
              `/zones/${zoneId}/email/routing/dns`,
              { method: "POST" },
            );
          }
          const catchAll = await this.cloudflareApi<{
            enabled?: boolean;
            actions?: Array<{ type: string; value?: string[] }>;
          }>(token, `/zones/${zoneId}/email/routing/rules/catch_all`);
          const alreadyTargetsWorker = catchAll.actions?.some(
            (action) =>
              action.type === "worker" && action.value?.includes("unimailbox"),
          );
          if (catchAll.enabled && !alreadyTargetsWorker) {
            throw new DomainError(
              "CLOUDFLARE_CATCH_ALL_CONFLICT",
              "An enabled Email Routing catch-all already targets another destination",
              409,
            );
          }
          if (!alreadyTargetsWorker) {
            await this.cloudflareApi(
              token,
              `/zones/${zoneId}/email/routing/rules/catch_all`,
              {
                method: "PUT",
                body: JSON.stringify({
                  name: "UniMailbox Worker",
                  enabled: true,
                  matchers: [{ type: "all" }],
                  actions: [{ type: "worker", value: ["unimailbox"] }],
                }),
              },
            );
          }
          cloudflareRouting = {
            dns: "ready",
            catchAll: "unimailbox",
          };
        }
        try {
          await this.database
            .prepare(
              `INSERT INTO domains (id, name, status)
               VALUES (?, ?, 'active')`,
            )
            .bind(domain.id, domain.name)
            .run();
        } catch {
          throw new DomainError(
            "DOMAIN_CONFLICT",
            "This managed domain already exists",
            409,
          );
        }
      },
    });
    return {
      ...domain,
      expectedRoute: `*@${domain.name} -> unimailbox Worker`,
      ...(cloudflareRouting ? { cloudflareRouting } : {}),
    };
  }

  async inboundSmokeTest(
    input: { token?: string },
    request: Request,
  ): Promise<unknown> {
    const session = await this.requireSession(request);
    const key = `setup:inbound-smoke:${session.id}`;
    if (!input.token) {
      const domain = await this.database
        .prepare(
          "SELECT id, name FROM domains WHERE status = 'active' ORDER BY created_at LIMIT 1",
        )
        .first<{ id: string; name: string }>();
      if (!domain) {
        throw new DomainError(
          "DOMAIN_NOT_FOUND",
          "Create a managed domain before the smoke test",
          409,
        );
      }
      const token = `unimailbox-smoke-${crypto.randomUUID()}`;
      await this.kv.put(key, token, { expirationTtl: 3600 });
      return {
        status: "awaiting_message",
        recipient: `postmaster@${domain.name}`,
        subject: token,
        token,
      };
    }
    const expected = await this.kv.get(key);
    if (!expected || !timingSafeEqual(expected, input.token)) {
      throw new DomainError(
        "INBOUND_SMOKE_TOKEN_INVALID",
        "The inbound smoke-test token is invalid or expired",
        409,
      );
    }
    const received = await this.database
      .prepare(
        `SELECT id FROM messages
         WHERE status = 'received' AND subject = ?
         LIMIT 1`,
      )
      .bind(input.token)
      .first<{ id: string }>();
    if (!received) {
      return { status: "awaiting_message", token: input.token };
    }
    await this.transition(request, {
      expected: InstallationStep.INBOUND_SMOKE_TEST,
      next: InstallationStep.BREVO,
      verify: async () => undefined,
    });
    await this.kv.delete(key);
    return { status: "received", messageId: received.id };
  }

  async connectBrevo(
    input: {
      providerKey: string;
      label: string;
      apiKey: string;
      webhookSecret: string;
      domainId: string;
    },
    request: Request,
  ): Promise<unknown> {
    const providerKey = parseProviderKey(input.providerKey);
    if (providerKey !== BREVO_PROVIDER_KEY) {
      throw new DomainError(
        "PROVIDER_NOT_SUPPORTED",
        "Only Brevo is available in the first release",
      );
    }
    const plugin = this.providers.get(providerKey);
    const connectionId = crypto.randomUUID();
    const credentialId = crypto.randomUUID();
    const secrets = plugin.validateConnectionInput({
      apiKey: input.apiKey,
      webhookSecret: input.webhookSecret,
    }) as Record<string, string>;
    await plugin.outbound.validateConnection({
      connectionId,
      config: {},
      secrets,
    });
    const encrypted = await this.credentials.encrypt(secrets);
    await this.transition(request, {
      expected: InstallationStep.BREVO,
      next: InstallationStep.OUTBOUND_SMOKE_TEST,
      verify: async () => {
        await this.database.batch([
          this.database
            .prepare(
              `INSERT INTO encrypted_credentials (
                 id, encrypted_payload, encryption_version
               ) VALUES (?, ?, 1)`,
            )
            .bind(credentialId, encrypted),
          this.database
            .prepare(
              `INSERT INTO provider_connections (
                 id, provider_key, label, credential_id, status, config_json,
                 last_health_check_at
               ) VALUES (?, ?, ?, ?, 'active', '{}', CURRENT_TIMESTAMP)`,
            )
            .bind(connectionId, providerKey, input.label, credentialId),
          this.database
            .prepare(
              `UPDATE domains SET outbound_connection_id = ?,
                 updated_at = CURRENT_TIMESTAMP
               WHERE id = ? AND status = 'active'`,
            )
            .bind(connectionId, input.domainId),
        ]);
      },
    });
    return { connectionId, providerKey, status: "active" };
  }

  async outboundSmokeTest(
    input: { connectionId: string; from: string; to: string },
    request: Request,
  ): Promise<unknown> {
    const connection = await this.database
      .prepare(
        `SELECT pc.provider_key, pc.config_json, ec.encrypted_payload
         FROM provider_connections pc
         JOIN encrypted_credentials ec ON ec.id = pc.credential_id
         WHERE pc.id = ? AND pc.status = 'active'`,
      )
      .bind(input.connectionId)
      .first<{
        provider_key: string;
        config_json: string;
        encrypted_payload: string;
      }>();
    if (!connection) {
      throw new DomainError(
        "PROVIDER_CONNECTION_NOT_FOUND",
        "Provider connection not found",
        404,
      );
    }
    const plugin = this.providers.get(
      parseProviderKey(connection.provider_key),
    );
    const result = await plugin.outbound.send(
      {
        connectionId: input.connectionId,
        config: JSON.parse(connection.config_json) as Record<string, unknown>,
        secrets: await this.credentials.decrypt(connection.encrypted_payload),
      },
      {
        idempotencyKey: crypto.randomUUID(),
        from: { address: input.from },
        to: [{ address: input.to }],
        cc: [],
        bcc: [],
        subject: "UniMailbox outbound smoke test",
        html: "<p>Your UniMailbox outbound connection is ready.</p>",
        text: "Your UniMailbox outbound connection is ready.",
        attachments: [],
      },
    );
    await this.transition(request, {
      expected: InstallationStep.OUTBOUND_SMOKE_TEST,
      next: InstallationStep.COMPLETE,
      verify: async () => undefined,
    });
    return {
      status: "sent",
      providerMessageId: result.providerMessageId,
    };
  }

  async complete(_request: Request): Promise<InstallationStatus> {
    return this.installation.getStatus().then((status) => {
      if (status.currentStep !== InstallationStep.COMPLETE) {
        throw new DomainError(
          "INSTALLATION_INCOMPLETE",
          "Complete every required setup step first",
          409,
        );
      }
      return status;
    });
  }

  private async transition(
    request: Request,
    input: {
      expected: InstallationStep;
      next: InstallationStep;
      verify: () => Promise<void>;
    },
  ): Promise<InstallationStatus> {
    const session = await this.requireSession(request);
    const requestId =
      request.headers.get("x-request-id") ?? crypto.randomUUID();
    if (session.repair) {
      if (input.expected === InstallationStep.ADMIN) {
        throw new DomainError(
          "REPAIR_ACTION_FORBIDDEN",
          "Repair mode cannot create another first administrator",
          409,
        );
      }
      await input.verify();
      await this.database
        .prepare(
          `INSERT INTO audit_events (
             id, action, resource_type, resource_id, request_id, metadata_json
           ) VALUES (?, 'installation.repair.checkpoint',
                     'installation', '1', ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          requestId,
          JSON.stringify({ checkpoint: input.expected }),
        )
        .run();
      return this.installation.getStatus();
    }
    return this.installation.advance({
      ...input,
      requestId,
    });
  }

  private async cloudflareAccessToken(): Promise<string | null> {
    const credential = await this.database
      .prepare(
        `SELECT ec.id, ec.encrypted_payload
         FROM installation_state state
         JOIN encrypted_credentials ec
           ON ec.id = state.cloudflare_credential_id
         WHERE state.id = 1`,
      )
      .first<{ id: string; encrypted_payload: string }>();
    if (!credential) return null;
    const secrets = await this.credentials.decrypt(
      credential.encrypted_payload,
    );
    if (
      !secrets.refreshToken ||
      Number(secrets.expiresAt ?? 0) > Date.now() + 60_000
    ) {
      return secrets.accessToken ?? null;
    }
    const clientId = this.oauth.clientId
      ? await readSecretBinding(this.oauth.clientId)
      : "";
    const clientSecret = this.oauth.clientSecret
      ? await readSecretBinding(this.oauth.clientSecret)
      : "";
    if (!clientId || !clientSecret) return secrets.accessToken ?? null;
    const response = await fetch("https://dash.cloudflare.com/oauth2/token", {
      method: "POST",
      headers: {
        authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: secrets.refreshToken,
      }),
    });
    if (!response.ok) {
      throw new DomainError(
        "CLOUDFLARE_OAUTH_REFRESH_FAILED",
        "Cloudflare did not refresh the OAuth authorization",
        502,
      );
    }
    const tokens = await response.json<{
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
      token_type: string;
    }>();
    const next = {
      ...secrets,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? secrets.refreshToken,
      tokenType: tokens.token_type,
      scope: tokens.scope ?? secrets.scope ?? "",
      expiresAt: String(Date.now() + (tokens.expires_in ?? 3600) * 1000),
    };
    await this.database
      .prepare(
        `UPDATE encrypted_credentials
         SET encrypted_payload = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(await this.credentials.encrypt(next), credential.id)
      .run();
    return next.accessToken;
  }

  private async cloudflareApi<T = unknown>(
    accessToken: string,
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4${path}`,
      {
        ...init,
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
          ...init.headers,
        },
      },
    );
    const body = await response.json<{
      success: boolean;
      result: T;
      errors?: Array<{ code: number; message: string }>;
    }>();
    if (!response.ok || !body.success) {
      throw new DomainError(
        "CLOUDFLARE_API_FAILED",
        "Cloudflare could not verify or configure Email Routing",
        502,
        {
          status: response.status,
          errors: body.errors?.map((error) => ({
            code: error.code,
            message: error.message,
          })),
        },
      );
    }
    return body.result;
  }
}
