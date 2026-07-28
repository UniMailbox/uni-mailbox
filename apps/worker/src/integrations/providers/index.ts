import {
  DomainError,
  type ProviderKey,
  type ProviderPlugin,
} from "@unimailbox/contracts";

export interface ProviderConnection {
  id: string;
  providerKey: ProviderKey;
  status: "active" | "disabled" | "invalid";
}

export class ProviderRegistry {
  constructor(
    private readonly providers: ReadonlyMap<ProviderKey, ProviderPlugin>,
  ) {
    for (const [key, plugin] of providers) {
      const declaredKeys = [
        plugin.outbound.key,
        plugin.webhook?.key,
        plugin.sync?.key,
      ].filter((value): value is ProviderKey => value !== undefined);
      if (declaredKeys.some((declaredKey) => declaredKey !== key)) {
        throw new Error(`Provider plugin key mismatch for ${key}`);
      }
    }
  }

  get(providerKey: ProviderKey): ProviderPlugin {
    const plugin = this.providers.get(providerKey);
    if (!plugin) {
      throw new DomainError(
        "PROVIDER_ADAPTER_NOT_REGISTERED",
        `Provider ${providerKey} is not registered`,
      );
    }
    return plugin;
  }

  keys(): ReadonlySet<ProviderKey> {
    return new Set(this.providers.keys());
  }
}

export function selectProviderConnection(input: {
  connection: ProviderConnection;
  registeredProviders: ReadonlySet<ProviderKey>;
}): ProviderConnection {
  if (input.connection.status !== "active") {
    throw new DomainError(
      "PROVIDER_CONNECTION_INACTIVE",
      "The outbound provider connection is not active",
    );
  }
  if (!input.registeredProviders.has(input.connection.providerKey)) {
    throw new DomainError(
      "PROVIDER_NOT_CONFIGURED",
      `Provider ${input.connection.providerKey} has no registered adapter`,
    );
  }
  return input.connection;
}
