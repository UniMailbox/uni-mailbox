import { describe, expect, it, vi } from "vitest";
import { StructuredLogger } from "../../src/platform/logger";
import { readSecretBinding, resolveRuntimeConfig } from "../../src/platform/config";
import type { Env } from "../../src/platform/config";

describe("StructuredLogger", () => {
  it("emits structured JSON log lines", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const logger = new StructuredLogger({ service: "test" });
    logger.info("event.info");
    logger.warn("event.warn", { token: "should-redact" });
    logger.error("event.error", { body: "should-redact" });

    expect(log).toHaveBeenCalledTimes(3);
    const calls = log.mock.calls.map((args) => JSON.parse(String(args[0])));
    expect(calls[0]).toMatchObject({
      level: "info",
      event: "event.info",
      service: "test",
    });
    expect(calls[1]).toMatchObject({
      level: "warn",
      event: "event.warn",
      token: "[REDACTED]",
    });
    expect(calls[2]).toMatchObject({
      level: "error",
      event: "event.error",
      body: "[REDACTED]",
    });
  });
});

describe("secret binding helpers", () => {
  it("returns the value of a string binding directly", async () => {
    await expect(readSecretBinding("literal-secret")).resolves.toBe(
      "literal-secret",
    );
  });

  it("invokes secret store bindings", async () => {
    const binding = { get: async () => "resolved-secret" };
    await expect(readSecretBinding(binding)).resolves.toBe("resolved-secret");
  });

  it("loads and validates the runtime configuration", async () => {
    const env = {
      INSTALLATION_TOKEN: { get: async () => "x".repeat(32) },
      AUTH_SIGNING_KEY: { get: async () => "y".repeat(32) },
      CREDENTIAL_ENCRYPTION_KEY: { get: async () => "z".repeat(32) },
    } as unknown as Env;
    const config = await resolveRuntimeConfig(env);
    expect(config.AUTH_SIGNING_KEY.length).toBe(32);
  });
});