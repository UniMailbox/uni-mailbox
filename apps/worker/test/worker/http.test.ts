import { describe, expect, it, vi } from "vitest";
import { InstallationStep } from "@unimailbox/contracts";
import { createHttpApp, type HttpAppContext } from "../../src/http/router";
import type { Env } from "../../src/platform/config";

function context(overrides: Partial<HttpAppContext> = {}): HttpAppContext {
  return {
    installation: {
      getStatus: async () => ({
        installationVersion: 1,
        stateVersion: 0,
        currentStep: InstallationStep.CLAIM,
        completedSteps: [],
      }),
    },
    health: {
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
    setup: {
      claim: vi.fn(),
      requireSession: vi.fn(),
      preflight: vi.fn(),
    } as unknown as HttpAppContext["setup"],
    auth: {
      verifyAccessToken: vi.fn(),
    },
    identity: {} as HttpAppContext["identity"],
    mailboxes: {} as HttpAppContext["mailboxes"],
    messages: {} as HttpAppContext["messages"],
    attachments: {} as HttpAppContext["attachments"],
    drafts: {} as HttpAppContext["drafts"],
    webhooks: {} as HttpAppContext["webhooks"],
    admin: {} as HttpAppContext["admin"],
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    ...overrides,
  };
}

const env = {} as Env;

function idempotencyDatabase() {
  const records = new Map<
    string,
    { request_hash: string; response_json: string }
  >();
  return {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async first() {
              if (!sql.includes("SELECT request_hash")) return null;
              return (
                records.get(`${values[0]}:${values[1]}:${values[2]}`) ?? null
              );
            },
            async run() {
              if (sql.includes("INSERT INTO idempotency_records")) {
                records.set(`${values[1]}:${values[2]}:${values[3]}`, {
                  request_hash: String(values[4]),
                  response_json: String(values[6]),
                });
              }
              return { success: true, meta: { changes: 1 } };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}

describe("Worker HTTP boundary", () => {
  it("exposes health and setup status before installation", async () => {
    const app = createHttpApp(async () => context());

    const health = await app.request("/health", {}, env);
    const setup = await app.request("/api/v1/setup/status", {}, env);

    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toMatchObject({
      data: { status: "ok" },
    });
    expect(setup.status).toBe(200);
    await expect(setup.json()).resolves.toMatchObject({
      data: { currentStep: "claim" },
    });
  });

  it("redirects ordinary application routes to setup until complete", async () => {
    const app = createHttpApp(async () => context());
    const response = await app.request("/inbox/mailbox-1", {}, env);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("/setup");
  });

  it("returns structured errors with request IDs", async () => {
    const app = createHttpApp(async () =>
      context({
        health: {
          check: async () => {
            throw new Error("database detail must stay private");
          },
        },
      }),
    );
    const response = await app.request("/health", {}, env);
    const body = (await response.json()) as {
      error: { code: string; message: string; requestId: string };
    };

    expect(response.status).toBe(500);
    expect(body.error).toMatchObject({
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred",
    });
    expect(body.error.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27}$/u);
    expect(body.error.message).not.toContain("database detail");
  });

  it("uses a strict same-origin CORS policy", async () => {
    const app = createHttpApp(async () => context());
    const denied = await app.request(
      "https://mail.example/health",
      { headers: { origin: "https://evil.example" } },
      env,
    );
    const allowed = await app.request(
      "https://mail.example/health",
      { headers: { origin: "https://mail.example" } },
      env,
    );

    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
    expect(allowed.headers.get("access-control-allow-origin")).toBe(
      "https://mail.example",
    );
  });

  it("replays administrator mutations by idempotency key", async () => {
    const createDomain = vi.fn(async (_principal: unknown, name: string) => ({
      id: "domain-1",
      name,
    }));
    const completeContext = context({
      installation: {
        getStatus: async () => ({
          installationVersion: 1,
          stateVersion: 8,
          currentStep: InstallationStep.COMPLETE,
          completedSteps: [],
        }),
      },
      auth: {
        verifyAccessToken: async () => ({
          userId: "user-1",
          email: "admin@example.com",
          permissions: new Set(["domain.manage"]),
        }),
      },
      admin: { createDomain } as unknown as HttpAppContext["admin"],
    });
    const app = createHttpApp(async () => completeContext);
    const testEnv = {
      DB: idempotencyDatabase(),
    } as Env;
    const request = () =>
      app.request(
        "https://mail.example/api/v1/admin/domains",
        {
          method: "POST",
          headers: {
            authorization: "Bearer token",
            "content-type": "application/json",
            "idempotency-key": "admin-command-1",
          },
          body: JSON.stringify({ name: "mail.example.com" }),
        },
        testEnv,
      );

    const first = await request();
    const replay = await request();

    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(replay.headers.get("x-idempotent-replay")).toBe("1");
    expect(createDomain).toHaveBeenCalledTimes(1);
    await expect(replay.json()).resolves.toEqual({
      data: { id: "domain-1", name: "mail.example.com" },
    });
  });
});
