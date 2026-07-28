import { applyD1Migrations, env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InstallationStep } from "@unimailbox/contracts";
import { CredentialCipher } from "../../src/platform/crypto";
import { InstallationService } from "../../src/modules/installation";
import { D1InstallationRepository } from "../../src/modules/installation/infrastructure/d1-installation.repository";
import { SetupApplicationService } from "../../src/modules/installation/setup-use-cases";
import { IdentityApplicationService } from "../../src/modules/identity/application";
import { TokenService } from "../../src/modules/identity";
import type { Env } from "../../src/platform/config";

const installationToken = "installation-token-".padEnd(40, "x");

function setupService() {
  const installation = new InstallationService(
    new D1InstallationRepository(env.DB),
  );
  return new SetupApplicationService(
    env.KV,
    installation,
    {
      check: async () => ({
        status: "ok",
        checks: {
          database: "ok",
          kv: "ok",
          r2: "ok",
          queue: "ok",
          assets: "ok",
          scheduled: "ok",
        },
      }),
    },
    {
      INSTALLATION_TOKEN: installationToken,
      AUTH_SIGNING_KEY: "a".repeat(32),
      CREDENTIAL_ENCRYPTION_KEY: "e".repeat(32),
      ALLOWED_ORIGINS: [],
    },
    env.DB,
    new IdentityApplicationService(
      env as unknown as Env,
      new TokenService("a".repeat(32)),
    ),
    new CredentialCipher("e".repeat(32)),
    {} as never,
    {
      clientId: "oauth-client-id",
      clientSecret: "oauth-client-secret",
      scopes: "zone.read email_routing.write",
    },
  );
}

function sessionRequest(
  token: string,
  csrfToken: string,
  cookieName = "unimailbox_setup",
  path = "/api/v1/setup/preflight",
) {
  return new Request(`https://mail.example${path}`, {
    headers: {
      cookie: `${cookieName}=${token}`,
      "x-setup-csrf": csrfToken,
      "x-request-id": crypto.randomUUID(),
    },
  });
}

describe("setup resume, takeover prevention, repair, and OAuth", () => {
  beforeEach(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  });

  it("resumes the claimed session and blocks a second takeover", async () => {
    const setup = setupService();
    const claimed = await setup.claim(
      installationToken,
      new Request("https://mail.example/api/v1/setup/claim"),
    );

    await expect(
      setup.requireSession(sessionRequest(claimed.token, claimed.csrfToken)),
    ).resolves.toMatchObject({ csrfToken: claimed.csrfToken });
    await expect(
      setup.claim(
        installationToken,
        new Request("https://mail.example/api/v1/setup/claim"),
      ),
    ).rejects.toMatchObject({ code: "INSTALLATION_STEP_CONFLICT" });
    await expect(
      new InstallationService(new D1InstallationRepository(env.DB)).getStatus(),
    ).resolves.toMatchObject({
      currentStep: InstallationStep.PREFLIGHT,
      stateVersion: 1,
    });
  });

  it("creates the first administrator with one-time hashed recovery codes", async () => {
    const setup = setupService();
    const claimed = await setup.claim(
      installationToken,
      new Request("https://mail.example/api/v1/setup/claim"),
    );
    const request = sessionRequest(claimed.token, claimed.csrfToken);
    await setup.preflight(request);
    const result = (await setup.administrator(
      {
        email: "admin@example.com",
        password: "a-strong-password",
        displayName: "Administrator",
      },
      request,
    )) as { userId: string; recoveryCodes: string[] };

    expect(result.recoveryCodes).toHaveLength(10);
    expect(new Set(result.recoveryCodes).size).toBe(10);
    const stored = await env.DB.prepare(
      `SELECT code_hash FROM account_recovery_codes
       WHERE user_id = ? ORDER BY id`,
    )
      .bind(result.userId)
      .all<{ code_hash: string }>();
    expect(stored.results).toHaveLength(10);
    expect(stored.results.map((row) => row.code_hash)).not.toContain(
      result.recoveryCodes[0],
    );
  });

  it("hides completed setup until an administrator opens repair mode", async () => {
    const setup = setupService();
    const claimed = await setup.claim(
      installationToken,
      new Request("https://mail.example/api/v1/setup/claim"),
    );
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO users (
           id, email, password_hash, password_salt, password_iterations,
           display_name
         ) VALUES (?, 'admin@example.com', 'hash', 'salt', 1, 'Admin')`,
      ).bind("11111111-1111-4111-8111-111111111111"),
      env.DB.prepare(
        `UPDATE installation_state
         SET current_step = 'complete', status = 'complete',
             completed_at = CURRENT_TIMESTAMP
         WHERE id = 1`,
      ),
    ]);

    await expect(
      setup.requireSession(sessionRequest(claimed.token, claimed.csrfToken)),
    ).rejects.toMatchObject({ code: "SETUP_NOT_FOUND", status: 404 });
    const repair = await setup.openRepairSession(
      {
        userId: "11111111-1111-4111-8111-111111111111",
        email: "admin@example.com",
        permissions: new Set(["settings.manage"]),
      },
      new Request("https://mail.example/api/v1/setup/repair"),
    );
    await expect(
      setup.requireSession(
        sessionRequest(repair.token, repair.csrfToken, "unimailbox_repair"),
      ),
    ).resolves.toMatchObject({ repair: true });
  });

  it("uses state and PKCE and stores exchanged OAuth tokens encrypted", async () => {
    const setup = setupService();
    const claimed = await setup.claim(
      installationToken,
      new Request("https://mail.example/api/v1/setup/claim"),
    );
    await env.DB.prepare(
      `UPDATE installation_state SET current_step = 'cloudflare' WHERE id = 1`,
    ).run();
    const request = sessionRequest(
      claimed.token,
      claimed.csrfToken,
      "unimailbox_setup",
      "/api/v1/setup/cloudflare/oauth/start",
    );
    const { url } = await setup.cloudflareOauthStart(request);
    const authorization = new URL(url);

    expect(authorization.origin).toBe("https://dash.cloudflare.com");
    expect(authorization.pathname).toBe("/oauth2/auth");
    expect(authorization.searchParams.get("code_challenge_method")).toBe(
      "S256",
    );
    expect(url).not.toContain("oauth-client-secret");

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({
        access_token: "cloudflare-access-token",
        refresh_token: "cloudflare-refresh-token",
        token_type: "Bearer",
        expires_in: 3600,
        scope: "zone.read",
      }),
    );
    const callback = new URL(
      "/api/v1/setup/cloudflare/oauth/callback",
      "https://mail.example",
    );
    callback.searchParams.set(
      "state",
      authorization.searchParams.get("state") ?? "",
    );
    callback.searchParams.set("code", "authorization-code");

    await expect(
      setup.cloudflareOauthCallback(new Request(callback)),
    ).resolves.toEqual(
      new URL("https://mail.example/setup?cloudflare=connected"),
    );
    const encrypted = await env.DB.prepare(
      `SELECT ec.encrypted_payload
       FROM installation_state state
       JOIN encrypted_credentials ec
         ON ec.id = state.cloudflare_credential_id
       WHERE state.id = 1`,
    ).first<{ encrypted_payload: string }>();
    expect(encrypted?.encrypted_payload).not.toContain(
      "cloudflare-access-token",
    );

    await env.DB.prepare(
      `INSERT INTO users (
         id, email, password_hash, password_salt, password_iterations,
         display_name
       ) VALUES (?, 'admin@example.com', 'hash', 'salt', 1, 'Admin')`,
    )
      .bind("11111111-1111-4111-8111-111111111111")
      .run();
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 200 }));
    await expect(
      setup.revokeCloudflareOauth(
        {
          userId: "11111111-1111-4111-8111-111111111111",
          email: "admin@example.com",
          permissions: new Set(["settings.manage"]),
        },
        new Request(
          "https://mail.example/api/v1/setup/cloudflare/oauth/revoke",
        ),
      ),
    ).resolves.toEqual({ revoked: true });
    await expect(
      env.DB.prepare(
        "SELECT cloudflare_credential_id FROM installation_state WHERE id = 1",
      ).first<{ cloudflare_credential_id: string | null }>(),
    ).resolves.toMatchObject({ cloudflare_credential_id: null });
  });
});
