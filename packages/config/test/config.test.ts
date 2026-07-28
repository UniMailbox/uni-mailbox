import { describe, expect, it } from "vitest";
import { RuntimeConfigSchema, runtimePolicy } from "../src";

describe("runtime configuration schema", () => {
  it("accepts a complete configuration", () => {
    const result = RuntimeConfigSchema.parse({
      AUTH_SIGNING_KEY: "y".repeat(32),
      CREDENTIAL_ENCRYPTION_KEY: "z".repeat(32),
    });

    expect(result.ALLOWED_ORIGINS).toEqual([]);
  });

  it("preserves configured allowed origins", () => {
    const result = RuntimeConfigSchema.parse({
      AUTH_SIGNING_KEY: "y".repeat(32),
      CREDENTIAL_ENCRYPTION_KEY: "z".repeat(32),
      ALLOWED_ORIGINS: ["https://mail.example.com"],
    });
    expect(result.ALLOWED_ORIGINS).toEqual(["https://mail.example.com"]);
  });

  it("rejects any secret shorter than 32 characters", () => {
    expect(() =>
      RuntimeConfigSchema.parse({
        AUTH_SIGNING_KEY: "short",
        CREDENTIAL_ENCRYPTION_KEY: "z".repeat(32),
      }),
    ).toThrow();
    expect(() =>
      RuntimeConfigSchema.parse({
        AUTH_SIGNING_KEY: "y".repeat(32),
        CREDENTIAL_ENCRYPTION_KEY: "short",
      }),
    ).toThrow();
  });

  it("rejects origins that are not URLs", () => {
    expect(() =>
      RuntimeConfigSchema.parse({
        AUTH_SIGNING_KEY: "y".repeat(32),
        CREDENTIAL_ENCRYPTION_KEY: "z".repeat(32),
        ALLOWED_ORIGINS: ["not-a-url"],
      }),
    ).toThrow();
  });
});

describe("runtime policy", () => {
  it("exposes deterministic numeric tunings", () => {
    expect(runtimePolicy.accessTokenTtlSeconds).toBe(900);
    expect(runtimePolicy.refreshTokenTtlSeconds).toBe(30 * 24 * 60 * 60);
    expect(runtimePolicy.oauthStateTtlSeconds).toBe(600);
    expect(runtimePolicy.passwordIterations).toBe(310_000);
    expect(runtimePolicy.outboundAttemptLimit).toBe(5);
    expect(runtimePolicy.webhookLockTtlMs).toBe(120_000);
    expect(runtimePolicy.outboundLockTtlMs).toBe(300_000);
    expect(runtimePolicy.providerSyncPageLimit).toBe(100);
    expect(runtimePolicy.webhookRequestsPerMinute).toBe(1_000);
  });
});
