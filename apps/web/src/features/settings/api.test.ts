import type { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import {
  cloudflareDomainMutationOptions,
  cloudflareProviderMutationOptions,
  cloudflareStatusQueryOptions,
  infrastructureQueryOptions,
  r2VerifyMutationOptions,
  settingsKeys,
} from "./api";

function queryClient() {
  return {
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
  } as unknown as QueryClient;
}

describe("settings query ownership", () => {
  it("uses feature-owned keys for checkpoint and infrastructure reads", () => {
    expect(settingsKeys.checkpoints()).toEqual([
      "settings",
      "cloudflare",
      "checkpoints",
    ]);
    expect(settingsKeys.infrastructure()).toEqual([
      "settings",
      "infrastructure",
    ]);
    expect(cloudflareStatusQueryOptions().queryKey).toEqual(
      settingsKeys.checkpoints(),
    );
    expect(infrastructureQueryOptions().queryKey).toEqual(
      settingsKeys.infrastructure(),
    );
  });

  it("invalidates checkpoints and administration domains after a Cloudflare domain write", async () => {
    const client = queryClient();
    const options = cloudflareDomainMutationOptions(client);
    await options.onSuccess?.(
      {
        id: "11111111-1111-4111-8111-111111111111",
        name: "mail.example.com",
        expectedRoute: "*@mail.example.com -> unimailbox Worker",
      },
      { name: "mail.example.com" },
      undefined,
      undefined as never,
    );
    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: settingsKeys.checkpoints(),
    });
    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["admin", "domains"],
    });
  });

  it("invalidates checkpoints and administration providers after provider and R2 writes", async () => {
    const client = queryClient();
    await cloudflareProviderMutationOptions(client).onSuccess?.(
      {
        connectionId: "11111111-1111-4111-8111-111111111111",
        providerKey: "brevo",
        status: "active",
      },
      {
        label: "Primary",
        apiKey: "12345678",
        webhookSecret: "abcdefgh",
        domainId: "22222222-2222-4222-8222-222222222222",
      },
      undefined,
      undefined as never,
    );
    await r2VerifyMutationOptions(client).onSuccess?.(
      { status: "verified", backend: "r2" },
      undefined,
      undefined,
      undefined as never,
    );
    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: settingsKeys.checkpoints(),
    });
    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["admin", "provider-connections"],
    });
    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: settingsKeys.infrastructure(),
    });
  });
});
