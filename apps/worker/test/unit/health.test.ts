import { describe, expect, it, vi } from "vitest";
import { HealthService } from "../../src/modules/maintenance";
import type { Env } from "../../src/platform/config";

function envFixture(
  withR2: boolean,
  options: {
    lastRun?: string | null;
    databaseError?: boolean;
    kvError?: boolean;
  } = {},
): Env {
  const base: Env = {
    DB: {
      prepare: vi.fn().mockReturnValue({
        first: options.databaseError
          ? vi.fn().mockRejectedValue(new Error("database unavailable"))
          : vi.fn().mockResolvedValue({ healthy: 1 }),
      }),
    } as unknown as D1Database,
    KV: {
      get: options.kvError
        ? vi.fn().mockRejectedValue(new Error("KV unavailable"))
        : vi.fn().mockResolvedValue(options.lastRun ?? null),
      put: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
      getWithMetadata: vi.fn(),
    } as unknown as KVNamespace,
    OUTBOUND_QUEUE: {} as Queue,
    ASSETS: {} as Fetcher,
    AUTH_SIGNING_KEY: "x",
    CREDENTIAL_ENCRYPTION_KEY: "x",
  };
  if (withR2) {
    base.ATTACHMENTS = {} as R2Bucket;
  }
  return base;
}

describe("HealthService", () => {
  it("reports the KV backend and ok health when ATTACHMENTS is absent", async () => {
    const service = new HealthService(envFixture(false), "kv");
    const result = await service.check();
    expect(result.storage.backend).toBe("kv");
    expect(result.storage.reason).toContain("KV is the default");
    expect(result.checks.r2).toBe("missing");
    expect(result.checks.kv).toBe("ok");
    expect(result.checks.scheduled).toBe("pending");
    expect(result.status).toBe("ok");
  });

  it("reports the R2 backend when ATTACHMENTS is bound", async () => {
    const service = new HealthService(envFixture(true), "r2");
    const result = await service.check();
    expect(result.storage.backend).toBe("r2");
    expect(result.storage.reason).toContain("ATTACHMENTS binding");
    expect(result.checks.r2).toBe("ok");
  });

  it("reports recent and stale scheduled heartbeats", async () => {
    const now = Date.now();
    await expect(
      new HealthService(envFixture(false, { lastRun: String(now) }), "kv")
        .check()
        .then((result) => result.checks.scheduled),
    ).resolves.toBe("ok");
    const stale = await new HealthService(
      envFixture(false, { lastRun: String(now - 6 * 60 * 1000) }),
      "kv",
    ).check();
    expect(stale.checks.scheduled).toBe("stale");
    expect(stale.status).toBe("degraded");
  });

  it("degrades when database or KV checks fail", async () => {
    const database = await new HealthService(
      envFixture(false, { databaseError: true }),
      "kv",
    ).check();
    expect(database.checks.database).toBe("error");
    expect(database.status).toBe("degraded");

    const kv = await new HealthService(
      envFixture(false, { kvError: true }),
      "kv",
    ).check();
    expect(kv.checks.scheduled).toBe("error");
    expect(kv.status).toBe("degraded");
  });

  it("requires the active R2 binding and all common bindings", async () => {
    const missing = {
      ...envFixture(false),
      OUTBOUND_QUEUE: undefined,
      ASSETS: undefined,
    } as unknown as Env;
    const result = await new HealthService(missing, "r2").check();
    expect(result.checks.queue).toBe("missing");
    expect(result.checks.assets).toBe("missing");
    expect(result.checks.r2).toBe("missing");
    expect(result.status).toBe("degraded");
    expect(result.storage.reason).toContain("ATTACHMENTS binding");
  });

  it("reports missing database and KV bindings without invoking them", async () => {
    const result = await new HealthService(
      {
        ...envFixture(false),
        DB: undefined,
        KV: undefined,
      } as unknown as Env,
      "kv",
    ).check();
    expect(result.checks.database).toBe("missing");
    expect(result.checks.kv).toBe("missing");
    expect(result.status).toBe("degraded");
  });
});
