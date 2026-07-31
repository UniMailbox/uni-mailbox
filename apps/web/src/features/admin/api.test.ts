import type { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import {
  adminKeys,
  adminQueryOptions,
  adminMutationOptions,
  auditEventsQueryOptions,
} from "./api";

function queryClient() {
  return { invalidateQueries: vi.fn().mockResolvedValue(undefined) } as unknown as QueryClient;
}

describe("administration query ownership", () => {
  it("normalizes audit search before its key and request input", () => {
    expect(adminKeys.auditEvents("  mailbox  ")).toEqual(["admin", "audit-events", "mailbox"]);
    expect(auditEventsQueryOptions("  mailbox  ").queryKey).toEqual(adminKeys.auditEvents("mailbox"));
  });

  it("keeps list query keys feature-owned", () => {
    expect(adminQueryOptions("users").queryKey).toEqual(adminKeys.resource("users"));
    expect(adminQueryOptions("analytics").queryKey).toEqual(adminKeys.resource("analytics"));
  });

  it("invalidates changed resources and related checkpoints", async () => {
    const client = queryClient();
    const mutations = adminMutationOptions(client);
    await mutations.create.onSuccess?.({ id: "11111111-1111-4111-8111-111111111111", name: "mail.example.com" } as never, { resource: "domains", name: "mail.example.com" }, undefined, undefined as never);
    await mutations.update.onSuccess?.({ id: "11111111-1111-4111-8111-111111111111", status: "disabled" } as never, { resource: "provider-connections", id: "11111111-1111-4111-8111-111111111111", status: "disabled" }, undefined, undefined as never);
    expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: adminKeys.resource("domains") });
    expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: adminKeys.resource("provider-connections") });
    expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["settings", "cloudflare", "checkpoints"] });
  });
});
