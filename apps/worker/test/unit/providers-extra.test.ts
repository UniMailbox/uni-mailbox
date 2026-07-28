import { describe, expect, it, vi } from "vitest";
import { BREVO_PROVIDER_KEY } from "@unimailbox/contracts";
import { ProviderRegistry, type ProviderConnection } from "../../src/integrations/providers";
import { createBrevoProviderPlugin } from "../../src/integrations/brevo";

describe("ProviderRegistry keys", () => {
  it("exposes the registered providers", () => {
    const registry = new ProviderRegistry(
      new Map([[BREVO_PROVIDER_KEY, createBrevoProviderPlugin()]]),
    );
    expect(registry.keys()).toEqual(new Set([BREVO_PROVIDER_KEY]));
  });
});

describe("createBrevoProviderPlugin", () => {
  it("returns a configured plugin with all capabilities", () => {
    const plugin = createBrevoProviderPlugin(vi.fn());
    expect(plugin.outbound.key).toBe(BREVO_PROVIDER_KEY);
    expect(plugin.webhook?.key).toBe(BREVO_PROVIDER_KEY);
    expect(plugin.sync?.key).toBe(BREVO_PROVIDER_KEY);
  });

  it("validates and parses Brevo connection input", () => {
    const plugin = createBrevoProviderPlugin(vi.fn());
    const parsed = plugin.validateConnectionInput({
      apiKey: "xkeysib-1234",
      webhookSecret: "secret-9876",
    }) as { apiKey: string; webhookSecret: string };
    expect(parsed.apiKey).toBe("xkeysib-1234");
    expect(parsed.webhookSecret).toBe("secret-9876");
  });

  it("rejects connection input that does not match the schema", () => {
    const plugin = createBrevoProviderPlugin(vi.fn());
    expect(() => plugin.validateConnectionInput({ apiKey: "short" })).toThrow();
  });
});

describe("selectProviderConnection edge cases", () => {
  const connection: ProviderConnection = {
    id: "c1",
    providerKey: BREVO_PROVIDER_KEY,
    status: "active",
  };

  it("rejects an invalid connection status", async () => {
    const { selectProviderConnection } = await import(
      "../../src/integrations/providers"
    );
    expect(() =>
      selectProviderConnection({
        connection: { ...connection, status: "invalid" },
        registeredProviders: new Set([BREVO_PROVIDER_KEY]),
      }),
    ).toThrowError(/not active/i);
  });
});