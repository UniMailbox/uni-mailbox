import { describe, expect, it } from "vitest";
import { administrationEndpoints } from "../src/api/administration";

const id = "11111111-1111-4111-8111-111111111111";
const mailboxId = "22222222-2222-4222-8222-222222222222";
const headers = { "idempotency-key": "admin-request-1" };

describe("administration endpoint contracts", () => {
  it("models every Worker-backed administration read", () => {
    expect(administrationEndpoints.users.responses[200].parse([])).toEqual([]);
    expect(administrationEndpoints.roles.responses[200].parse([])).toEqual([]);
    expect(administrationEndpoints.domains.responses[200].parse([])).toEqual(
      [],
    );
    expect(
      administrationEndpoints.providerConnections.responses[200].parse([]),
    ).toEqual([]);
    expect(
      administrationEndpoints.signature.responses[200].parse({
        domain_id: id,
        html_content: "",
        text_content: "",
        is_enabled: 0,
      }),
    ).toMatchObject({ domain_id: id });
    expect(
      administrationEndpoints.settings.responses[200].parse({
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
      }).site_title,
    ).toBe("UniMailbox");
    expect(
      administrationEndpoints.webhookEvents.responses[200].parse([]),
    ).toEqual([]);
    expect(
      administrationEndpoints.auditEvents.responses[200].parse([]),
    ).toEqual([]);
    expect(
      administrationEndpoints.messages.responses[200].parse({
        items: [],
        nextCursor: null,
      }),
    ).toEqual({ items: [], nextCursor: null });
    expect(
      administrationEndpoints.attachments.responses[200].parse({
        items: [],
        nextCursor: null,
      }),
    ).toEqual({ items: [], nextCursor: null });
    expect(
      administrationEndpoints.analytics.responses[200].parse({
        active_users: 1,
        active_mailboxes: 2,
        received_messages: 3,
        sent_messages: 4,
        failed_jobs: 5,
        failed_webhooks: 6,
      }).active_users,
    ).toBe(1);
  });

  it("declares idempotency and current request shapes for every mutation", () => {
    expect(
      administrationEndpoints.createUser.request?.headers?.parse(headers),
    ).toEqual(headers);
    expect(
      administrationEndpoints.createUser.request?.body?.parse({
        email: "admin@example.com",
        displayName: "Admin",
        password: "correct-horse-battery-staple",
        roleIds: [id],
      }),
    ).toMatchObject({ email: "admin@example.com" });
    expect(
      administrationEndpoints.updateUser.request?.params?.parse({ id }),
    ).toEqual({ id });
    expect(administrationEndpoints.deleteUser.responses[204]).toBeNull();
    expect(
      administrationEndpoints.createRole.request?.body?.parse({
        name: "Operators",
        description: "",
        permissions: ["user.read"],
      }),
    ).toMatchObject({ name: "Operators" });
    expect(
      administrationEndpoints.updateRole.request?.body?.parse({
        description: "",
        permissions: [],
      }),
    ).toEqual({ description: "", permissions: [] });
    expect(administrationEndpoints.deleteRole.responses[204]).toBeNull();
    expect(
      administrationEndpoints.createDomain.request?.body?.parse({
        name: "mail.example.com",
      }),
    ).toEqual({ name: "mail.example.com" });
    expect(
      administrationEndpoints.updateDomain.request?.body?.parse({
        status: "disabled",
      }),
    ).toEqual({ status: "disabled" });
    expect(administrationEndpoints.deleteDomain.responses[204]).toBeNull();
    expect(
      administrationEndpoints.createProviderConnection.request?.body?.parse({
        providerKey: "brevo",
        label: "Primary",
        apiKey: "12345678",
        webhookSecret: "abcdefgh",
      }),
    ).toMatchObject({ providerKey: "brevo" });
    expect(
      administrationEndpoints.updateProviderConnection.request?.body?.parse({
        status: "disabled",
      }),
    ).toEqual({ status: "disabled" });
    expect(
      administrationEndpoints.saveSignature.request?.body?.parse({
        html: "<p>Hi</p>",
        text: "Hi",
        enabled: true,
      }),
    ).toEqual({ html: "<p>Hi</p>", text: "Hi", enabled: true });
    expect(
      administrationEndpoints.saveSettings.request?.body?.parse({
        site_title: "UniMailbox",
      }),
    ).toEqual({ site_title: "UniMailbox" });
    expect(
      administrationEndpoints.deleteWebhookEvent.responses[204],
    ).toBeNull();
    expect(
      administrationEndpoints.providerSync.request?.headers?.parse(headers),
    ).toEqual(headers);
  });

  it("models the per-user mailbox access endpoints with human email addresses", () => {
    const items = administrationEndpoints.userMailboxes.responses[200].parse({
      items: [
        {
          mailboxId,
          address: "support@example.com",
          displayName: "Support",
          status: "active",
          domainId: id,
          role: "viewer",
          ownerUserId: id,
          ownerEmail: "owner@example.com",
          ownerDisplayName: "Owner",
        },
      ],
      available: [
        {
          mailboxId: "33333333-3333-4333-8333-333333333333",
          address: "sales@example.com",
          displayName: "Sales",
          status: "active",
          ownerEmail: "owner@example.com",
        },
      ],
    });
    expect(items.items[0]).toMatchObject({
      address: "support@example.com",
      role: "viewer",
      ownerEmail: "owner@example.com",
    });
    expect(items.available[0]?.address).toBe("sales@example.com");
    expect(
      administrationEndpoints.userRoleOptions.responses[200].parse([
        { id, name: "Administrators", is_system: 1 },
      ]),
    ).toEqual([{ id, name: "Administrators", is_system: 1 }]);
    expect(
      administrationEndpoints.userMailboxes.request?.params?.safeParse({
        id: "not-a-uuid",
      }).success,
    ).toBe(false);

    expect(
      administrationEndpoints.addUserMailbox.request?.body?.parse({
        mailboxId,
        role: "admin",
      }),
    ).toMatchObject({ mailboxId, role: "admin" });
    expect(
      administrationEndpoints.addUserMailbox.request?.body?.safeParse({
        mailboxId,
        role: "owner",
      }).success,
    ).toBe(false);

    expect(
      administrationEndpoints.updateUserMailbox.request?.body?.parse({
        role: "sender",
      }),
    ).toEqual({ role: "sender" });
    expect(administrationEndpoints.removeUserMailbox.responses[204]).toBeNull();
  });

  it("uses normalized bounded query parameters for audit and webhook reads", () => {
    expect(
      administrationEndpoints.auditEvents.request?.query?.parse({
        limit: 100,
        q: "  mailbox  ",
      }),
    ).toEqual({ limit: 100, q: "mailbox" });
    expect(
      administrationEndpoints.webhookEvents.request?.query?.parse({
        limit: 600,
      }),
    ).toEqual({ limit: 500 });
    expect(
      administrationEndpoints.messages.request?.query?.parse({ limit: 600 }),
    ).toEqual({ limit: 100 });
    expect(
      administrationEndpoints.attachments.request?.query?.parse({
        limit: 600,
        q: "  report.pdf  ",
      }),
    ).toEqual({ limit: 100, q: "report.pdf" });
    expect(
      administrationEndpoints.message.request?.params?.safeParse({
        id: "not-a-uuid",
      }).success,
    ).toBe(false);
  });
});
