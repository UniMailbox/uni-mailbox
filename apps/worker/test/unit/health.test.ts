import { describe, expect, it, vi } from "vitest";
import { HealthService } from "../../src/modules/maintenance";
import type { Env } from "../../src/platform/config";

function envFixture(withR2: boolean): Env {
  const base: Env = {
    DB: {} as D1Database,
    KV: {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
      getWithMetadata: vi.fn(),
    } as unknown as KVNamespace,
    OUTBOUND_QUEUE: {} as Queue,
    ASSETS: {} as Fetcher,
    INSTALLATION_TOKEN: "x",
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
  });

  it("reports the R2 backend when ATTACHMENTS is bound", async () => {
    const service = new HealthService(envFixture(true), "r2");
    const result = await service.check();
    expect(result.storage.backend).toBe("r2");
    expect(result.storage.reason).toContain("ATTACHMENTS binding");
    expect(result.checks.r2).toBe("ok");
  });
});