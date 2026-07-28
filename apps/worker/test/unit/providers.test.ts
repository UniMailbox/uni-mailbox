import { describe, expect, it, vi } from "vitest";
import {
  BREVO_PROVIDER_KEY,
  type ProviderPlugin,
  parseProviderKey,
} from "@unimailbox/contracts";
import {
  ProviderRegistry,
  selectProviderConnection,
} from "../../src/integrations/providers";

function plugin(key = BREVO_PROVIDER_KEY): ProviderPlugin {
  return {
    outbound: {
      key,
      validateConnection: vi.fn(),
      send: vi.fn(),
    },
    validateConnectionInput: (value) => value,
  };
}

describe("provider registry", () => {
  it("returns registered plugins and rejects unknown providers", () => {
    const registry = new ProviderRegistry(
      new Map([[BREVO_PROVIDER_KEY, plugin()]]),
    );

    expect(registry.get(BREVO_PROVIDER_KEY).outbound.key).toBe("brevo");
    expect(() => registry.get(parseProviderKey("postal"))).toThrowError(
      /not registered/i,
    );
  });

  it("rejects plugin key mismatches at composition time", () => {
    expect(
      () =>
        new ProviderRegistry(
          new Map([[BREVO_PROVIDER_KEY, plugin(parseProviderKey("postal"))]]),
        ),
    ).toThrowError(/key mismatch/i);
  });

  it("adds a second provider through registry composition only", () => {
    const postal = parseProviderKey("postal");
    const registry = new ProviderRegistry(
      new Map([
        [BREVO_PROVIDER_KEY, plugin()],
        [postal, plugin(postal)],
      ]),
    );

    expect(registry.get(postal).outbound.key).toBe(postal);
    expect(registry.get(BREVO_PROVIDER_KEY).outbound.key).toBe(
      BREVO_PROVIDER_KEY,
    );
  });
});

describe("provider connection selection", () => {
  const activeConnection = {
    id: "connection",
    providerKey: BREVO_PROVIDER_KEY,
    status: "active" as const,
  };

  it("requires an active registered connection", () => {
    expect(
      selectProviderConnection({
        connection: activeConnection,
        registeredProviders: new Set([BREVO_PROVIDER_KEY]),
      }),
    ).toBe(activeConnection);
  });

  it("never falls back for inactive or unregistered connections", () => {
    expect(() =>
      selectProviderConnection({
        connection: { ...activeConnection, status: "disabled" },
        registeredProviders: new Set([BREVO_PROVIDER_KEY]),
      }),
    ).toThrowError(/not active/i);

    expect(() =>
      selectProviderConnection({
        connection: activeConnection,
        registeredProviders: new Set(),
      }),
    ).toThrowError(/no registered adapter/i);
  });
});
