import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import {
  adminKeys,
  adminQueryOptions,
  adminMutationOptions,
  auditEventsQueryOptions,
  adminFormSchemas,
  canAdminWrite,
  providerSyncMutationOptions,
  saveSettingsMutationOptions,
  saveSignatureMutationOptions,
} from "./api";

function queryClient() {
  const client = new QueryClient();
  vi.spyOn(client, "invalidateQueries").mockResolvedValue();
  return client;
}

function manualDomainResult(id: string, name = "mail.example.com") {
  return {
    id,
    name,
    expectedRoute: `*@${name} -> unimailbox Worker`,
    routingConfiguration: {
      status: "manual_setup_required" as const,
      dashboardUrl:
        "https://dash.cloudflare.com/?to=%2Faccount-1%2Femail-service%2Frouting",
    },
  };
}

describe("administration query ownership", () => {
  it("normalizes audit search before its key and request input", () => {
    expect(adminKeys.auditEvents("  mailbox  ")).toEqual([
      "admin",
      "audit-events",
      "mailbox",
    ]);
    expect(auditEventsQueryOptions("  mailbox  ").queryKey).toEqual(
      adminKeys.auditEvents("mailbox"),
    );
  });

  it("keeps list query keys feature-owned", () => {
    expect(adminQueryOptions("users").queryKey).toEqual(
      adminKeys.resource("users"),
    );
    expect(adminQueryOptions("analytics").queryKey).toEqual(
      adminKeys.resource("analytics"),
    );
  });

  it("invalidates create and update resource caches with related checkpoints", async () => {
    const client = queryClient();
    const mutations = adminMutationOptions(client);
    await mutations.create.onSuccess?.(
      manualDomainResult("11111111-1111-4111-8111-111111111111"),
      { resource: "domains", name: "mail.example.com" },
      undefined,
      { client, meta: undefined, mutationKey: undefined },
    );
    await mutations.update.onSuccess?.(
      { id: "11111111-1111-4111-8111-111111111111", status: "disabled" },
      {
        resource: "provider-connections",
        id: "11111111-1111-4111-8111-111111111111",
        status: "disabled",
      },
      undefined,
      { client, meta: undefined, mutationKey: undefined },
    );
    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: adminKeys.resource("domains"),
    });
    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: adminKeys.resource("provider-connections"),
    });
    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["settings", "cloudflare", "checkpoints"],
    });
  });

  it("invalidates deleted records and their resource list", async () => {
    const client = queryClient();
    const id = "11111111-1111-4111-8111-111111111111";
    await adminMutationOptions(client).delete.onSuccess?.(
      undefined,
      { resource: "users", id },
      undefined,
      { client, meta: undefined, mutationKey: undefined },
    );
    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: adminKeys.detail("users", id),
    });
    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: adminKeys.resource("users"),
    });
  });

  it("invalidates every administration mutation's affected cache keys", async () => {
    const client = queryClient();
    const id = "11111111-1111-4111-8111-111111111111";
    const context = { client, meta: undefined, mutationKey: undefined };
    const mutations = adminMutationOptions(client);

    await mutations.create.onSuccess?.(
      { id, email: "admin@example.com" },
      {
        resource: "users",
        email: "admin@example.com",
        displayName: "Admin",
        password: "a-strong-password",
        roleIds: [],
      },
      undefined,
      context,
    );
    await mutations.create.onSuccess?.(
      { id, name: "operator", description: "", permissions: [] },
      { resource: "roles", name: "operator", description: "", permissions: [] },
      undefined,
      context,
    );
    await mutations.create.onSuccess?.(
      manualDomainResult(id),
      { resource: "domains", name: "mail.example.com" },
      undefined,
      context,
    );
    await mutations.create.onSuccess?.(
      { id, providerKey: "brevo", label: "Primary", status: "active" },
      {
        resource: "provider-connections",
        providerKey: "brevo",
        label: "Primary",
        apiKey: "12345678",
        webhookSecret: "12345678",
      },
      undefined,
      context,
    );
    await mutations.update.onSuccess?.(
      { id },
      { resource: "users", id, displayName: "Admin" },
      undefined,
      context,
    );
    await mutations.update.onSuccess?.(
      { id, description: "", permissions: [] },
      { resource: "roles", id, description: "", permissions: [] },
      undefined,
      context,
    );
    await mutations.update.onSuccess?.(
      { id },
      { resource: "domains", id, status: "disabled" },
      undefined,
      context,
    );
    await mutations.update.onSuccess?.(
      { id, status: "active" },
      { resource: "provider-connections", id, status: "active" },
      undefined,
      context,
    );
    await mutations.delete.onSuccess?.(
      undefined,
      { resource: "users", id },
      undefined,
      context,
    );
    await mutations.delete.onSuccess?.(
      undefined,
      { resource: "roles", id },
      undefined,
      context,
    );
    await mutations.delete.onSuccess?.(
      undefined,
      { resource: "domains", id },
      undefined,
      context,
    );
    await mutations.delete.onSuccess?.(
      undefined,
      { resource: "webhook-events", id },
      undefined,
      context,
    );
    await saveSignatureMutationOptions(client, id).onSuccess?.(
      { domain_id: id, html_content: "", text_content: "", is_enabled: 1 },
      { html: "", text: "", enabled: true },
      undefined,
      context,
    );
    await saveSettingsMutationOptions(client).onSuccess?.(
      {
        site_title: "UniMailbox",
        registration_enabled: 1,
        invite_required: 0,
        inbound_enabled: 1,
        outbound_enabled: 1,
        unknown_recipient_policy: "reject",
        max_mailboxes_per_user: 10,
        max_attachments_per_message: 20,
        max_attachment_bytes: 1024,
        sender_blocklist_json: "[]",
        subject_blocklist_json: "[]",
        content_blocklist_json: "[]",
      },
      { site_title: "UniMailbox" },
      undefined,
      context,
    );
    await providerSyncMutationOptions(client).onSuccess?.(
      { inserted: 0, updated: 0, skipped: 0, failed: 0 },
      undefined,
      undefined,
      context,
    );

    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: adminKeys.resource("users"),
    });
    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: adminKeys.detail("users", id),
    });
    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: adminKeys.resource("roles"),
    });
    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: adminKeys.detail("roles", id),
    });
    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: adminKeys.resource("domains"),
    });
    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: adminKeys.detail("domains", id),
    });
    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: adminKeys.resource("provider-connections"),
    });
    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: adminKeys.detail("provider-connections", id),
    });
    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: adminKeys.resource("webhook-events"),
    });
    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: adminKeys.detail("webhook-events", id),
    });
    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: adminKeys.signature(id),
    });
    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: adminKeys.resource("signatures"),
    });
    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: adminKeys.resource("settings"),
    });
    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["settings", "cloudflare", "checkpoints"],
    });
  });

  it("requires the exact Worker write permission for every control", () => {
    expect(canAdminWrite("users", ["user.read"])).toBe(false);
    expect(canAdminWrite("users", ["user.manage"])).toBe(true);
    expect(canAdminWrite("roles", ["role.manage"])).toBe(true);
    expect(canAdminWrite("domains", ["domain.manage"])).toBe(true);
    expect(canAdminWrite("provider-connections", ["domain.manage"])).toBe(true);
    expect(canAdminWrite("signatures", ["signature.read"])).toBe(false);
    expect(canAdminWrite("signatures", ["signature.manage"])).toBe(true);
    expect(canAdminWrite("settings", ["settings.manage"])).toBe(true);
    expect(canAdminWrite("webhook-events", ["webhook_event.delete"])).toBe(
      true,
    );
    expect(canAdminWrite("provider-sync", ["domain.manage"])).toBe(false);
    expect(canAdminWrite("provider-sync", ["provider.sync"])).toBe(true);
  });

  it("validates administrative form input before a mutation is requested", () => {
    expect(
      adminFormSchemas.createUser.safeParse({
        displayName: "Admin",
        email: "bad",
        password: "short",
        roleIds: "not-a-uuid",
      }).success,
    ).toBe(false);
    expect(
      adminFormSchemas.manageUser.safeParse({
        action: "update",
        id: "not-a-uuid",
        displayName: "",
        status: "",
        roleIds: "",
      }).success,
    ).toBe(false);
    expect(
      adminFormSchemas.settings.safeParse({
        site_title: "UniMailbox",
        registration_enabled: 1,
        invite_required: 0,
        inbound_enabled: 1,
        outbound_enabled: 1,
        unknown_recipient_policy: "reject",
        max_mailboxes_per_user: 0,
        max_attachments_per_message: 20,
        max_attachment_bytes: 1024,
      }).success,
    ).toBe(false);
  });
});
