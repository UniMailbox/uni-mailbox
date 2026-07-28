import {
  DomainError,
  CreateAttachmentUploadSchema,
  DraftMessageSchema,
  InstallationClaimSchema,
  InstallationStep,
  LoginSchema,
  MailboxCreateSchema,
  MailboxMemberSchema,
  ProviderConnectionSchema,
  RegisterSchema,
  SendMessageSchema,
  SetupAdministratorSchema,
  type InstallationStatus,
  type Principal,
} from "@unimailbox/contracts";
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { z } from "zod";
import type { AdminApplicationService } from "../modules/administration";
import type { InstallationService } from "../modules/installation";
import type { IdentityApplicationService } from "../modules/identity/application";
import type { MailboxApplicationService } from "../modules/mailboxes";
import type { HealthResult } from "../modules/maintenance";
import type { MessageApplicationService } from "../modules/messages";
import type { AttachmentApplicationService } from "../modules/attachments";
import type { DraftApplicationService } from "../modules/messages/drafts";
import type { WebhookApplicationService } from "../modules/provider-sync/webhook";
import type { Env } from "../platform/config";
import type { Logger } from "../platform/logger";
import { errorResponse } from "./errors";

export interface SetupSession {
  token: string;
  csrfToken: string;
  expiresAt: string;
}

export interface SetupUseCases {
  claim(token: string, request: Request): Promise<SetupSession>;
  requireSession(request: Request): Promise<{ id: string; csrfToken: string }>;
  preflight(request: Request): Promise<unknown>;
  administrator(
    input: { email: string; password: string; displayName: string },
    request: Request,
  ): Promise<unknown>;
  dashboardLink(input: {
    accountId: string;
    zoneId: string;
    destination: "email-routing" | "dns" | "worker";
  }): URL;
  verifyCloudflare(
    input: {
      accountId: string;
      zoneId: string;
      mode: "dashboard" | "oauth";
    },
    request: Request,
  ): Promise<unknown>;
  cloudflareOauthStart(request: Request): Promise<{ url: string }>;
  cloudflareOauthCallback(request: Request): Promise<URL>;
  revokeCloudflareOauth(
    principal: Principal,
    request: Request,
  ): Promise<{ revoked: boolean }>;
  openRepairSession(
    principal: Principal,
    request: Request,
  ): Promise<SetupSession>;
  createDomain(
    input: { name: string },
    principalRequest: Request,
  ): Promise<unknown>;
  inboundSmokeTest(
    input: { token?: string },
    request: Request,
  ): Promise<unknown>;
  connectBrevo(
    input: {
      providerKey: string;
      label: string;
      apiKey: string;
      webhookSecret: string;
      domainId: string;
    },
    request: Request,
  ): Promise<unknown>;
  outboundSmokeTest(
    input: { connectionId: string; from: string; to: string },
    request: Request,
  ): Promise<unknown>;
  complete(request: Request): Promise<InstallationStatus>;
}

export interface HttpAppContext {
  installation: Pick<InstallationService, "getStatus">;
  health: { check(): Promise<HealthResult> };
  setup: SetupUseCases;
  auth: {
    verifyAccessToken(token: string): Promise<Principal>;
  };
  identity: IdentityApplicationService;
  mailboxes: MailboxApplicationService;
  messages: MessageApplicationService;
  attachments: AttachmentApplicationService;
  drafts: DraftApplicationService;
  webhooks: WebhookApplicationService;
  admin: AdminApplicationService;
  logger: Logger;
}

export type HttpContextFactory = (
  env: Env,
  executionContext: ExecutionContext | undefined,
) => Promise<HttpAppContext>;

interface AppBindings {
  Bindings: Env;
  Variables: {
    appContext: HttpAppContext;
    requestId: string;
    principal: Principal;
  };
}

const SETUP_COOKIE = "unimailbox_setup";

function success<T>(data: T, init?: ResponseInit): Response {
  return Response.json({ data }, init);
}

function isSetupSafePath(path: string): boolean {
  return (
    path === "/health" ||
    path === "/setup" ||
    path.startsWith("/setup/") ||
    path.startsWith("/api/v1/setup/") ||
    path === "/api/v1/setup/status"
  );
}

function parseBearer(header: string | undefined): string | null {
  return header?.match(/^Bearer\s+(.+)$/iu)?.[1] ?? null;
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie") ?? "";
  for (const entry of header.split(";")) {
    const [key, ...parts] = entry.trim().split("=");
    if (key === name) return parts.join("=");
  }
  return null;
}

function refreshCookie(token: string, expiresAt: string): string {
  const maxAge = Math.max(
    0,
    Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000),
  );
  return `unimailbox_refresh=${token}; HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth; Max-Age=${maxAge}`;
}

async function requestHash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function createHttpApp(createContext: HttpContextFactory) {
  const app = new Hono<AppBindings>();

  app.use("*", secureHeaders());
  app.use("*", async (context, next) => {
    const requestId = context.req.header("cf-ray") ?? crypto.randomUUID();
    context.set("requestId", requestId);
    context.header("x-request-id", requestId);
    await next();
  });
  app.use("*", async (context, next) => {
    const origin = context.req.header("origin");
    const requestOrigin = new URL(context.req.url).origin;
    if (context.req.method === "OPTIONS") {
      if (origin === requestOrigin) {
        context.header("access-control-allow-origin", origin);
        context.header("vary", "Origin");
      }
      context.header(
        "access-control-allow-headers",
        "authorization, content-type, idempotency-key, if-match, x-setup-csrf",
      );
      context.header(
        "access-control-allow-methods",
        "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      );
      return context.body(null, 204);
    }
    await next();
    if (origin === requestOrigin) {
      context.res.headers.set("access-control-allow-origin", origin);
      context.res.headers.append("vary", "Origin");
    }
  });
  app.use("*", async (context, next) => {
    context.set("appContext", await createContext(context.env, undefined));
    await next();
  });
  app.use("*", async (context, next) => {
    if (!isSetupSafePath(context.req.path)) {
      const status = await context.get("appContext").installation.getStatus();
      if (status.currentStep !== InstallationStep.COMPLETE) {
        return context.redirect("/setup", 307);
      }
    }
    await next();
  });

  app.get("/health", async (context) =>
    success(await context.get("appContext").health.check()),
  );

  app.get("/api/v1/setup/status", async (context) =>
    success(await context.get("appContext").installation.getStatus()),
  );

  app.post("/api/v1/setup/claim", async (context) => {
    const input = InstallationClaimSchema.parse(await context.req.json());
    const session = await context
      .get("appContext")
      .setup.claim(input.token, context.req.raw);
    const response = success({
      csrfToken: session.csrfToken,
      expiresAt: session.expiresAt,
    });
    response.headers.append(
      "set-cookie",
      `${SETUP_COOKIE}=${session.token}; HttpOnly; Secure; SameSite=Strict; Path=/api/v1/setup; Max-Age=900`,
    );
    return response;
  });

  app.post("/api/v1/setup/preflight", async (context) => {
    await context.get("appContext").setup.requireSession(context.req.raw);
    return success(
      await context.get("appContext").setup.preflight(context.req.raw),
    );
  });
  app.post("/api/v1/setup/administrator", async (context) => {
    await context.get("appContext").setup.requireSession(context.req.raw);
    return success(
      await context
        .get("appContext")
        .setup.administrator(
          SetupAdministratorSchema.parse(await context.req.json()),
          context.req.raw,
        ),
      { status: 201 },
    );
  });
  app.post("/api/v1/setup/cloudflare/dashboard-link", async (context) => {
    await context.get("appContext").setup.requireSession(context.req.raw);
    const input = await context.req.json<{
      accountId?: unknown;
      zoneId?: unknown;
      destination?: unknown;
    }>();
    if (
      typeof input.accountId !== "string" ||
      typeof input.zoneId !== "string" ||
      !["email-routing", "dns", "worker"].includes(String(input.destination))
    ) {
      throw new DomainError(
        "VALIDATION_FAILED",
        "A valid Cloudflare dashboard destination is required",
      );
    }
    return success({
      url: context
        .get("appContext")
        .setup.dashboardLink({
          accountId: input.accountId,
          zoneId: input.zoneId,
          destination: input.destination as "email-routing" | "dns" | "worker",
        })
        .toString(),
    });
  });
  app.post("/api/v1/setup/cloudflare/verify", async (context) => {
    await context.get("appContext").setup.requireSession(context.req.raw);
    const input = await context.req.json<{
      accountId?: unknown;
      zoneId?: unknown;
      mode?: unknown;
    }>();
    if (
      typeof input.accountId !== "string" ||
      typeof input.zoneId !== "string" ||
      !["dashboard", "oauth"].includes(String(input.mode))
    ) {
      throw new DomainError(
        "VALIDATION_FAILED",
        "Dashboard-assisted Cloudflare setup metadata is invalid",
      );
    }
    return success(
      await context.get("appContext").setup.verifyCloudflare(
        {
          accountId: input.accountId,
          zoneId: input.zoneId,
          mode: input.mode as "dashboard" | "oauth",
        },
        context.req.raw,
      ),
    );
  });
  app.post("/api/v1/setup/cloudflare/oauth/start", async (context) => {
    await context.get("appContext").setup.requireSession(context.req.raw);
    return success(
      await context
        .get("appContext")
        .setup.cloudflareOauthStart(context.req.raw),
    );
  });
  app.get("/api/v1/setup/cloudflare/oauth/callback", async (context) =>
    context.redirect(
      (
        await context
          .get("appContext")
          .setup.cloudflareOauthCallback(context.req.raw)
      ).toString(),
      303,
    ),
  );
  app.use("/api/v1/setup/cloudflare/oauth/revoke", requireAuth());
  app.post("/api/v1/setup/cloudflare/oauth/revoke", async (context) =>
    success(
      await context
        .get("appContext")
        .setup.revokeCloudflareOauth(context.get("principal"), context.req.raw),
    ),
  );
  app.post("/api/v1/setup/domain", async (context) => {
    await context.get("appContext").setup.requireSession(context.req.raw);
    const input = await context.req.json<{ name?: unknown }>();
    if (
      typeof input.name !== "string" ||
      !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/iu.test(
        input.name,
      )
    ) {
      throw new DomainError(
        "VALIDATION_FAILED",
        "A valid managed domain is required",
      );
    }
    return success(
      await context
        .get("appContext")
        .setup.createDomain({ name: input.name }, context.req.raw),
      { status: 201 },
    );
  });
  app.post("/api/v1/setup/smoke-test/inbound", async (context) => {
    await context.get("appContext").setup.requireSession(context.req.raw);
    const input: { token?: unknown } = await context.req
      .json<{ token?: unknown }>()
      .catch(() => ({ token: undefined }));
    return success(
      await context.get("appContext").setup.inboundSmokeTest(
        {
          ...(typeof input.token === "string" ? { token: input.token } : {}),
        },
        context.req.raw,
      ),
    );
  });
  app.post("/api/v1/setup/brevo", async (context) => {
    await context.get("appContext").setup.requireSession(context.req.raw);
    const raw = await context.req.json<unknown>();
    const input = ProviderConnectionSchema.extend({
      domainId: SendMessageSchema.shape.mailboxId,
    }).parse(raw);
    return success(
      await context
        .get("appContext")
        .setup.connectBrevo(input, context.req.raw),
      { status: 201 },
    );
  });
  app.post("/api/v1/setup/smoke-test/outbound", async (context) => {
    await context.get("appContext").setup.requireSession(context.req.raw);
    const input = await context.req.json<{
      connectionId?: unknown;
      from?: unknown;
      to?: unknown;
    }>();
    if (
      typeof input.connectionId !== "string" ||
      typeof input.from !== "string" ||
      typeof input.to !== "string"
    ) {
      throw new DomainError(
        "VALIDATION_FAILED",
        "connectionId, from, and to are required",
      );
    }
    return success(
      await context.get("appContext").setup.outboundSmokeTest(
        {
          connectionId: input.connectionId,
          from: input.from,
          to: input.to,
        },
        context.req.raw,
      ),
    );
  });
  app.post("/api/v1/setup/complete", async (context) => {
    await context.get("appContext").setup.requireSession(context.req.raw);
    return success(
      await context.get("appContext").setup.complete(context.req.raw),
    );
  });
  app.use("/api/v1/setup/repair", requireAuth());
  app.post("/api/v1/setup/repair", async (context) => {
    const session = await context
      .get("appContext")
      .setup.openRepairSession(context.get("principal"), context.req.raw);
    const response = success({
      csrfToken: session.csrfToken,
      expiresAt: session.expiresAt,
    });
    response.headers.append(
      "set-cookie",
      `unimailbox_repair=${session.token}; HttpOnly; Secure; SameSite=Strict; Path=/api/v1/setup; Max-Age=900`,
    );
    return response;
  });

  app.post("/api/v1/webhooks/:providerKey/:connectionId", async (context) =>
    success(
      await context
        .get("appContext")
        .webhooks.handle(
          context.req.param("providerKey"),
          context.req.param("connectionId"),
          context.req.raw,
        ),
    ),
  );

  app.post("/api/v1/auth/register", async (context) =>
    success(
      await context
        .get("appContext")
        .identity.register(
          RegisterSchema.parse(await context.req.json()),
          context.req.raw,
        ),
      { status: 201 },
    ),
  );

  app.post("/api/v1/auth/login", async (context) => {
    const tokens = await context
      .get("appContext")
      .identity.login(
        LoginSchema.parse(await context.req.json()),
        context.req.raw,
      );
    const response = success({
      accessToken: tokens.accessToken,
      accessTokenExpiresIn: tokens.accessTokenExpiresIn,
      refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
    });
    response.headers.append(
      "set-cookie",
      refreshCookie(tokens.refreshToken, tokens.refreshTokenExpiresAt),
    );
    return response;
  });

  app.post("/api/v1/auth/refresh", async (context) => {
    const refreshToken = readCookie(context.req.raw, "unimailbox_refresh");
    if (!refreshToken) {
      throw new DomainError(
        "REFRESH_TOKEN_REQUIRED",
        "A refresh token is required",
        401,
      );
    }
    const tokens = await context
      .get("appContext")
      .identity.refresh(refreshToken, context.req.raw);
    const response = success({
      accessToken: tokens.accessToken,
      accessTokenExpiresIn: tokens.accessTokenExpiresIn,
      refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
    });
    response.headers.append(
      "set-cookie",
      refreshCookie(tokens.refreshToken, tokens.refreshTokenExpiresAt),
    );
    return response;
  });

  app.post("/api/v1/auth/logout", async (context) => {
    const refreshToken = readCookie(context.req.raw, "unimailbox_refresh");
    if (refreshToken) {
      await context.get("appContext").identity.logout(refreshToken);
    }
    const response = success({ revoked: true });
    response.headers.append(
      "set-cookie",
      "unimailbox_refresh=; HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth; Max-Age=0",
    );
    return response;
  });

  app.use("/api/v1/auth/logout-all", requireAuth());
  app.post("/api/v1/auth/logout-all", async (context) => {
    await context
      .get("appContext")
      .identity.logoutAll(context.get("principal").userId);
    return success({ revoked: true });
  });
  app.use("/api/v1/auth/password/reset", requireAuth());
  app.post("/api/v1/auth/password/reset", async (context) => {
    const input = z
      .object({
        currentPassword: z.string().min(12).max(1024),
        newPassword: z.string().min(12).max(1024),
      })
      .parse(await context.req.json());
    await context
      .get("appContext")
      .identity.resetPassword(
        context.get("principal"),
        input.currentPassword,
        input.newPassword,
      );
    return success({ reset: true, sessionsRevoked: true });
  });

  app.use("/api/v1/mailboxes", requireAuth());
  app.use("/api/v1/mailboxes/*", requireAuth());

  app.get("/api/v1/mailboxes", async (context) =>
    success(
      await context.get("appContext").mailboxes.list(context.get("principal")),
    ),
  );
  app.post("/api/v1/mailboxes", async (context) =>
    success(
      await context
        .get("appContext")
        .mailboxes.create(
          context.get("principal"),
          MailboxCreateSchema.parse(await context.req.json()),
        ),
      { status: 201 },
    ),
  );
  app.get("/api/v1/mailboxes/:id", async (context) =>
    success(
      await context
        .get("appContext")
        .mailboxes.get(context.get("principal"), context.req.param("id")),
    ),
  );
  app.patch("/api/v1/mailboxes/:id", async (context) => {
    const input = await context.req.json<{ displayName?: unknown }>();
    if (
      typeof input.displayName !== "string" ||
      input.displayName.length > 120
    ) {
      throw new DomainError(
        "VALIDATION_FAILED",
        "displayName must be a string up to 120 characters",
      );
    }
    return success(
      await context
        .get("appContext")
        .mailboxes.rename(
          context.get("principal"),
          context.req.param("id"),
          input.displayName,
        ),
    );
  });
  app.delete("/api/v1/mailboxes/:id", async (context) => {
    await context
      .get("appContext")
      .mailboxes.remove(context.get("principal"), context.req.param("id"));
    return context.body(null, 204);
  });
  app.get("/api/v1/mailboxes/:id/members", async (context) =>
    success(
      await context
        .get("appContext")
        .mailboxes.listMembers(
          context.get("principal"),
          context.req.param("id"),
        ),
    ),
  );
  app.post("/api/v1/mailboxes/:id/members", async (context) => {
    const input = MailboxMemberSchema.parse(await context.req.json());
    return success(
      await context
        .get("appContext")
        .mailboxes.upsertMember(
          context.get("principal"),
          context.req.param("id"),
          input.userId,
          input.role,
        ),
      { status: 201 },
    );
  });
  app.patch("/api/v1/mailboxes/:id/members/:userId", async (context) => {
    const input = MailboxMemberSchema.pick({ role: true }).parse(
      await context.req.json(),
    );
    return success(
      await context
        .get("appContext")
        .mailboxes.upsertMember(
          context.get("principal"),
          context.req.param("id"),
          context.req.param("userId"),
          input.role,
        ),
    );
  });
  app.delete("/api/v1/mailboxes/:id/members/:userId", async (context) => {
    await context
      .get("appContext")
      .mailboxes.removeMember(
        context.get("principal"),
        context.req.param("id"),
        context.req.param("userId"),
      );
    return context.body(null, 204);
  });

  app.use("/api/v1/messages", requireAuth());
  app.use("/api/v1/messages/*", requireAuth());
  app.post("/api/v1/messages/send", async (context) =>
    success(
      await context
        .get("appContext")
        .messages.send(
          context.get("principal"),
          SendMessageSchema.parse(await context.req.json()),
          context.req.header("idempotency-key") ?? "",
        ),
      { status: 201 },
    ),
  );
  app.get("/api/v1/messages/:id", async (context) =>
    success(
      await context
        .get("appContext")
        .messages.get(context.get("principal"), context.req.param("id")),
    ),
  );
  app.patch("/api/v1/messages/:id/read", async (context) => {
    const input = await context.req.json<{ isRead?: unknown }>();
    if (typeof input.isRead !== "boolean") {
      throw new DomainError("VALIDATION_FAILED", "isRead must be a boolean");
    }
    await context
      .get("appContext")
      .messages.setRead(
        context.get("principal"),
        context.req.param("id"),
        input.isRead,
      );
    return success({ updated: true });
  });
  app.patch("/api/v1/messages/:id/star", async (context) => {
    const input = await context.req.json<{ isStarred?: unknown }>();
    if (typeof input.isStarred !== "boolean") {
      throw new DomainError("VALIDATION_FAILED", "isStarred must be a boolean");
    }
    await context
      .get("appContext")
      .messages.setStarred(
        context.get("principal"),
        context.req.param("id"),
        input.isStarred,
      );
    return success({ updated: true });
  });
  app.patch("/api/v1/messages/:id/folder", async (context) => {
    const input = z
      .object({
        mailboxId: z.string().uuid(),
        folder: z.enum(["inbox", "archive", "trash"]),
      })
      .parse(await context.req.json());
    await context
      .get("appContext")
      .messages.move(
        context.get("principal"),
        context.req.param("id"),
        input.mailboxId,
        input.folder,
      );
    return success({ updated: true, folder: input.folder });
  });
  app.delete("/api/v1/messages/:id", async (context) => {
    await context
      .get("appContext")
      .messages.remove(context.get("principal"), context.req.param("id"));
    return context.body(null, 204);
  });
  app.get("/api/v1/messages/:id/attachments", async (context) =>
    success(
      await context
        .get("appContext")
        .messages.listAttachments(
          context.get("principal"),
          context.req.param("id"),
        ),
    ),
  );

  app.get("/api/v1/mailboxes/:id/messages", async (context) => {
    const folder = context.req.query("folder") ?? "inbox";
    if (!["inbox", "sent", "drafts", "archive", "trash"].includes(folder)) {
      throw new DomainError("VALIDATION_FAILED", "Invalid mailbox folder");
    }
    const rawLimit = Number.parseInt(context.req.query("limit") ?? "50", 10);
    const limit = Math.min(
      100,
      Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 50),
    );
    return success(
      await context
        .get("appContext")
        .messages.list(context.get("principal"), context.req.param("id"), {
          folder: folder as "inbox" | "sent" | "drafts" | "archive" | "trash",
          ...(context.req.query("cursor")
            ? { cursor: context.req.query("cursor") }
            : {}),
          limit,
          ...(context.req.query("starred") === "true" ? { starred: true } : {}),
        }),
    );
  });

  app.put("/api/v1/attachments/uploads/:id/content", async (context) => {
    await context
      .get("appContext")
      .attachments.uploadContent(
        context.req.param("id"),
        context.req.query("token") ?? "",
        context.req.raw,
      );
    return context.body(null, 204);
  });
  app.use("/api/v1/attachments", requireAuth());
  app.use("/api/v1/attachments/*", requireAuth());
  app.post("/api/v1/attachments/uploads", async (context) =>
    success(
      await context
        .get("appContext")
        .attachments.create(
          context.get("principal"),
          CreateAttachmentUploadSchema.parse(await context.req.json()),
          context.req.url,
        ),
      { status: 201 },
    ),
  );
  app.post("/api/v1/attachments/uploads/:id/complete", async (context) =>
    success(
      await context
        .get("appContext")
        .attachments.complete(
          context.get("principal"),
          context.req.param("id"),
        ),
    ),
  );
  app.delete("/api/v1/attachments/uploads/:id", async (context) => {
    await context
      .get("appContext")
      .attachments.cancel(context.get("principal"), context.req.param("id"));
    return context.body(null, 204);
  });
  app.get("/api/v1/attachments/:id/download", async (context) =>
    context
      .get("appContext")
      .attachments.download(context.get("principal"), context.req.param("id")),
  );

  app.use("/api/v1/drafts", requireAuth());
  app.use("/api/v1/drafts/*", requireAuth());
  app.post("/api/v1/drafts", async (context) => {
    const draft = await context
      .get("appContext")
      .drafts.create(
        context.get("principal"),
        DraftMessageSchema.parse(await context.req.json()),
      );
    const response = success(draft, { status: 201 });
    if ("updated_at" in draft && typeof draft.updated_at === "string") {
      response.headers.set("etag", `"${draft.updated_at}"`);
    }
    return response;
  });
  app.get("/api/v1/drafts", async (context) =>
    success(
      await context.get("appContext").drafts.list(context.get("principal")),
    ),
  );
  app.get("/api/v1/drafts/:id", async (context) => {
    const draft = await context
      .get("appContext")
      .drafts.get(context.get("principal"), context.req.param("id"));
    const response = success(draft);
    if ("updated_at" in draft && typeof draft.updated_at === "string") {
      response.headers.set("etag", `"${draft.updated_at}"`);
    }
    return response;
  });
  app.put("/api/v1/drafts/:id", async (context) => {
    const draft = await context
      .get("appContext")
      .drafts.update(
        context.get("principal"),
        context.req.param("id"),
        DraftMessageSchema.parse(await context.req.json()),
        context.req.header("if-match"),
      );
    const response = success(draft);
    if ("updated_at" in draft && typeof draft.updated_at === "string") {
      response.headers.set("etag", `"${draft.updated_at}"`);
    }
    return response;
  });
  app.delete("/api/v1/drafts/:id", async (context) => {
    await context
      .get("appContext")
      .drafts.remove(context.get("principal"), context.req.param("id"));
    return context.body(null, 204);
  });
  app.post("/api/v1/drafts/:id/send", async (context) =>
    success(
      await context
        .get("appContext")
        .drafts.send(
          context.get("principal"),
          context.req.param("id"),
          context.req.header("if-match"),
          context.req.header("idempotency-key") ?? "",
        ),
    ),
  );

  app.use("/api/v1/admin", requireAuth());
  app.use("/api/v1/admin/*", requireAuth());
  app.use("/api/v1/admin/*", requireAdminIdempotency());

  app.get("/api/v1/admin/users", async (context) =>
    success(
      await context.get("appContext").admin.listUsers(context.get("principal")),
    ),
  );
  app.post("/api/v1/admin/users", async (context) => {
    const input = z
      .object({
        email: z.string().trim().email(),
        password: z.string().min(12).max(1024),
        displayName: z.string().trim().min(1).max(120),
        roleIds: z.array(z.string().uuid()).max(20).default([]),
      })
      .parse(await context.req.json());
    return success(
      await context
        .get("appContext")
        .admin.createUser(context.get("principal"), input),
      { status: 201 },
    );
  });
  app.patch("/api/v1/admin/users/:id", async (context) => {
    const input = z
      .object({
        displayName: z.string().trim().min(1).max(120).optional(),
        status: z.enum(["active", "suspended"]).optional(),
        roleIds: z.array(z.string().uuid()).max(20).optional(),
      })
      .strict()
      .parse(await context.req.json());
    return success(
      await context
        .get("appContext")
        .admin.updateUser(
          context.get("principal"),
          context.req.param("id"),
          input,
        ),
    );
  });
  app.delete("/api/v1/admin/users/:id", async (context) => {
    await context
      .get("appContext")
      .admin.deleteUser(context.get("principal"), context.req.param("id"));
    return context.body(null, 204);
  });

  app.get("/api/v1/admin/roles", async (context) =>
    success(
      await context.get("appContext").admin.listRoles(context.get("principal")),
    ),
  );
  app.post("/api/v1/admin/roles", async (context) => {
    const input = z
      .object({
        name: z.string().trim().min(1).max(80),
        description: z.string().max(500).default(""),
        permissions: z.array(z.string()).max(100),
      })
      .parse(await context.req.json());
    return success(
      await context
        .get("appContext")
        .admin.createRole(context.get("principal"), input),
      { status: 201 },
    );
  });
  app.patch("/api/v1/admin/roles/:id", async (context) => {
    const input = z
      .object({
        description: z.string().max(500),
        permissions: z.array(z.string()).max(100),
      })
      .parse(await context.req.json());
    return success(
      await context
        .get("appContext")
        .admin.updateRole(
          context.get("principal"),
          context.req.param("id"),
          input,
        ),
    );
  });
  app.delete("/api/v1/admin/roles/:id", async (context) => {
    await context
      .get("appContext")
      .admin.deleteRole(context.get("principal"), context.req.param("id"));
    return context.body(null, 204);
  });

  app.get("/api/v1/admin/domains", async (context) =>
    success(
      await context
        .get("appContext")
        .admin.listDomains(context.get("principal")),
    ),
  );
  app.post("/api/v1/admin/domains", async (context) => {
    const input = z
      .object({
        name: z
          .string()
          .trim()
          .toLowerCase()
          .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u),
      })
      .parse(await context.req.json());
    return success(
      await context
        .get("appContext")
        .admin.createDomain(context.get("principal"), input.name),
      { status: 201 },
    );
  });
  app.patch("/api/v1/admin/domains/:id", async (context) => {
    const input = z
      .object({
        status: z.enum(["active", "disabled"]).optional(),
        outboundConnectionId: z.string().uuid().nullable().optional(),
      })
      .strict()
      .parse(await context.req.json());
    return success(
      await context
        .get("appContext")
        .admin.updateDomain(
          context.get("principal"),
          context.req.param("id"),
          input,
        ),
    );
  });
  app.delete("/api/v1/admin/domains/:id", async (context) => {
    await context
      .get("appContext")
      .admin.deleteDomain(context.get("principal"), context.req.param("id"));
    return context.body(null, 204);
  });
  app.get("/api/v1/admin/domains/:id/signature", async (context) =>
    success(
      await context
        .get("appContext")
        .admin.getSignature(context.get("principal"), context.req.param("id")),
    ),
  );
  app.put("/api/v1/admin/domains/:id/signature", async (context) => {
    const input = z
      .object({
        html: z.string().max(200_000),
        text: z.string().max(200_000),
        enabled: z.boolean(),
      })
      .parse(await context.req.json());
    return success(
      await context
        .get("appContext")
        .admin.putSignature(
          context.get("principal"),
          context.req.param("id"),
          input,
        ),
    );
  });

  app.get("/api/v1/admin/settings", async (context) =>
    success(
      await context
        .get("appContext")
        .admin.getSettings(context.get("principal")),
    ),
  );
  app.patch("/api/v1/admin/settings", async (context) =>
    success(
      await context.get("appContext").admin.updateSettings(
        context.get("principal"),
        z
          .object({
            site_title: z.string().trim().min(1).max(120).optional(),
            registration_enabled: z.coerce
              .number()
              .int()
              .min(0)
              .max(1)
              .optional(),
            invite_required: z.coerce.number().int().min(0).max(1).optional(),
            inbound_enabled: z.coerce.number().int().min(0).max(1).optional(),
            outbound_enabled: z.coerce.number().int().min(0).max(1).optional(),
            unknown_recipient_policy: z.enum(["reject", "store"]).optional(),
            max_mailboxes_per_user: z
              .number()
              .int()
              .min(1)
              .max(1_000)
              .optional(),
            max_attachments_per_message: z
              .number()
              .int()
              .min(1)
              .max(100)
              .optional(),
            max_attachment_bytes: z
              .number()
              .int()
              .min(1)
              .max(512 * 1024 * 1024)
              .optional(),
            sender_blocklist_json: z.array(z.string()).max(10_000).optional(),
            subject_blocklist_json: z.array(z.string()).max(10_000).optional(),
            content_blocklist_json: z.array(z.string()).max(10_000).optional(),
          })
          .strict()
          .parse(await context.req.json()),
      ),
    ),
  );

  app.get("/api/v1/admin/provider-connections", async (context) =>
    success(
      await context
        .get("appContext")
        .admin.listProviderConnections(context.get("principal")),
    ),
  );
  app.post("/api/v1/admin/provider-connections", async (context) => {
    const input = ProviderConnectionSchema.extend({
      config: z.record(z.unknown()).optional(),
    }).parse(await context.req.json());
    return success(
      await context
        .get("appContext")
        .admin.createProviderConnection(context.get("principal"), input),
      { status: 201 },
    );
  });
  app.patch("/api/v1/admin/provider-connections/:id", async (context) => {
    const input = z
      .object({
        status: z.enum(["active", "disabled"]).optional(),
        apiKey: z.string().min(8).optional(),
        webhookSecret: z.string().min(8).optional(),
      })
      .strict()
      .parse(await context.req.json());
    return success(
      await context
        .get("appContext")
        .admin.updateProviderConnection(
          context.get("principal"),
          context.req.param("id"),
          input,
        ),
    );
  });
  app.post("/api/v1/admin/providers/sync", async (context) =>
    success(
      await context
        .get("appContext")
        .admin.syncProviders(context.get("principal")),
    ),
  );
  app.get("/api/v1/admin/webhook-events", async (context) =>
    success(
      await context
        .get("appContext")
        .admin.listWebhookEvents(
          context.get("principal"),
          Number.parseInt(context.req.query("limit") ?? "100", 10),
        ),
    ),
  );
  app.delete("/api/v1/admin/webhook-events/:id", async (context) => {
    await context
      .get("appContext")
      .admin.deleteWebhookEvent(
        context.get("principal"),
        context.req.param("id"),
      );
    return context.body(null, 204);
  });
  app.get("/api/v1/admin/audit-events", async (context) =>
    success(
      await context
        .get("appContext")
        .admin.listAuditEvents(context.get("principal"), {
          limit: Number.parseInt(context.req.query("limit") ?? "100", 10),
          query: context.req.query("q"),
        }),
    ),
  );
  app.get("/api/v1/admin/analytics", async (context) =>
    success(
      await context.get("appContext").admin.analytics(context.get("principal")),
    ),
  );

  app.notFound(async (context) => {
    if (context.req.path.startsWith("/api/")) {
      throw new DomainError("NOT_FOUND", "Route not found", 404);
    }
    if (context.env.ASSETS) {
      return context.env.ASSETS.fetch(context.req.raw);
    }
    throw new DomainError("NOT_FOUND", "Route not found", 404);
  });

  app.onError((error, context) => {
    const requestId = context.get("requestId") ?? crypto.randomUUID();
    context.get("appContext")?.logger.error("http.request.failed", {
      requestId,
      path: context.req.path,
      method: context.req.method,
      error: error instanceof DomainError ? error.code : "INTERNAL_ERROR",
    });
    return errorResponse(error, requestId);
  });

  return app;
}

export function requireAuth(): MiddlewareHandler<AppBindings> {
  return async (context, next) => {
    const token = parseBearer(context.req.header("authorization"));
    if (!token) {
      throw new DomainError("AUTH_REQUIRED", "Authentication is required", 401);
    }
    context.set(
      "principal",
      await context.get("appContext").auth.verifyAccessToken(token),
    );
    await next();
  };
}

function requireAdminIdempotency(): MiddlewareHandler<AppBindings> {
  return async (context, next) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(context.req.method)) {
      await next();
      return;
    }
    const idempotencyKey = context.req.header("idempotency-key");
    if (!idempotencyKey || idempotencyKey.length > 255) {
      throw new DomainError(
        "IDEMPOTENCY_KEY_REQUIRED",
        "Administrator mutations require an Idempotency-Key",
        428,
      );
    }
    const principal = context.get("principal");
    const operation = `admin.${context.req.method.toLowerCase()}.${context.req.path}`;
    const rawBody = await context.req.raw.clone().text();
    const hash = await requestHash(
      JSON.stringify({
        method: context.req.method,
        path: context.req.path,
        body: rawBody,
      }),
    );
    const existing = await context.env.DB.prepare(
      `SELECT request_hash, response_json
       FROM idempotency_records
       WHERE actor_user_id = ? AND operation = ? AND idempotency_key = ?
         AND expires_at > CURRENT_TIMESTAMP`,
    )
      .bind(principal.userId, operation, idempotencyKey)
      .first<{ request_hash: string; response_json: string }>();
    if (existing) {
      if (existing.request_hash !== hash) {
        throw new DomainError(
          "IDEMPOTENCY_KEY_REUSED",
          "The idempotency key was used with different input",
          409,
        );
      }
      const replay = JSON.parse(existing.response_json) as {
        body: string;
        status: number;
        contentType: string | null;
      };
      return new Response(replay.body || null, {
        status: replay.status,
        headers: replay.contentType
          ? { "content-type": replay.contentType, "x-idempotent-replay": "1" }
          : { "x-idempotent-replay": "1" },
      });
    }

    await next();
    if (context.res.status < 200 || context.res.status >= 300) return;
    const response = context.res.clone();
    const body = await response.text();
    await context.env.DB.prepare(
      `INSERT INTO idempotency_records (
         id, actor_user_id, operation, idempotency_key, request_hash,
         response_status, response_json, expires_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', '+1 day'))`,
    )
      .bind(
        crypto.randomUUID(),
        principal.userId,
        operation,
        idempotencyKey,
        hash,
        response.status,
        JSON.stringify({
          body,
          status: response.status,
          contentType: response.headers.get("content-type"),
        }),
      )
      .run();
  };
}

export type { InstallationStatus };
