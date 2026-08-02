import { applyD1Migrations, env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BREVO_PROVIDER_KEY } from "@unimailbox/contracts";
import { createBrevoProviderPlugin } from "../../src/integrations/brevo";
import { ProviderRegistry } from "../../src/integrations/providers";
import { WebhookApplicationService } from "../../src/modules/provider-sync/webhook";
import { CredentialCipher } from "../../src/platform/crypto";

const connectionId = "66666666-6666-4666-8666-666666666666";
const messageId = "77777777-7777-4777-8777-777777777777";
const domainId = "88888888-8888-4888-8888-888888888888";
const cipher = new CredentialCipher("e".repeat(32));

function request(payload: Record<string, unknown>) {
  return new Request(
    `https://mail.example/api/v1/webhooks/brevo/${connectionId}`,
    {
      method: "POST",
      headers: {
        authorization: "Bearer webhook-test",
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );
}

function service(fetcher = vi.fn()) {
  const envRecord = env as unknown as Record<string, unknown>;
  return new WebhookApplicationService({
    env: {
      DB: env.DB,
      KV: env.KV,
      ATTACHMENTS: envRecord.ATTACHMENTS as R2Bucket | undefined,
      OUTBOUND_QUEUE: env.OUTBOUND_QUEUE,
      ASSETS: {} as Fetcher,
      AUTH_SIGNING_KEY: "x".repeat(32),
      CREDENTIAL_ENCRYPTION_KEY: "e".repeat(32),
    },
    providers: new ProviderRegistry(
      new Map([[BREVO_PROVIDER_KEY, createBrevoProviderPlugin(fetcher)]]),
    ),
    credentials: cipher,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  });
}

describe("verified provider webhook processing", () => {
  beforeEach(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO encrypted_credentials (
           id, encrypted_payload, encryption_version
         ) VALUES (?, ?, 1)`,
      ).bind(
        "55555555-5555-4555-8555-555555555555",
        await cipher.encrypt({
          apiKey: "xkeysib-test",
          webhookSecret: "webhook-test",
        }),
      ),
      env.DB.prepare(
        `INSERT INTO provider_connections (
           id, provider_key, label, credential_id, status
         ) VALUES (?, 'brevo', 'Primary', ?, 'active')`,
      ).bind(connectionId, "55555555-5555-4555-8555-555555555555"),
      env.DB.prepare(
        `INSERT INTO domains (id, name, status, outbound_connection_id)
         VALUES (?, 'example.com', 'active', ?)`,
      ).bind(domainId, connectionId),
      env.DB.prepare(
        `INSERT INTO messages (
           id, domain_id, thread_id, from_address, subject, provider_key,
           provider_connection_id, provider_message_id, status
         ) VALUES (?, ?, ?, 'sender@example.com', 'Webhook test', 'brevo',
                   ?, 'provider-message-1', 'sent')`,
      ).bind(messageId, domainId, messageId, connectionId),
    ]);
  });

  it("deduplicates delivery events and ignores older status regressions", async () => {
    const webhook = service();
    const delivered = {
      id: 42,
      event: "delivered",
      email: "to@example.com",
      "message-id": "provider-message-1",
      ts_event: 1_800_000_000,
    };

    await expect(
      webhook.handle("brevo", connectionId, request(delivered)),
    ).resolves.toEqual({ accepted: true, duplicate: false });
    await expect(
      webhook.handle("brevo", connectionId, request(delivered)),
    ).resolves.toEqual({ accepted: true, duplicate: true });
    await webhook.handle(
      "brevo",
      connectionId,
      request({
        ...delivered,
        id: 43,
        event: "request",
        ts_event: 1_799_999_999,
      }),
    );

    const message = await env.DB.prepare(
      "SELECT status FROM messages WHERE id = ?",
    )
      .bind(messageId)
      .first<{ status: string }>();
    const deliveries = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM webhook_deliveries",
    ).first<number>("count");
    const event = await env.DB.prepare(
      `SELECT domain_id, event_type FROM webhook_events
       WHERE provider_message_id = 'provider-message-1'
       ORDER BY created_at LIMIT 1`,
    ).first<{ domain_id: string; event_type: string }>();
    expect(message?.status).toBe("delivered");
    expect(deliveries).toBe(2);
    expect(event).toEqual({ domain_id: domainId, event_type: "delivered" });
  });

  it("imports an unknown provider message only into the bound domain", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        messageId: "provider-message-2",
        from: "sender@example.com",
        email: "to@example.net",
        subject: "Imported message",
        event: "delivered",
        date: "2026-08-02T12:00:00.000Z",
      }),
    );
    await expect(
      service(fetcher).handle(
        "brevo",
        connectionId,
        request({
          id: 44,
          event: "delivered",
          email: "to@example.net",
          "message-id": "provider-message-2",
          ts_event: 1_800_000_001,
        }),
      ),
    ).resolves.toEqual({ accepted: true, duplicate: false });

    const imported = await env.DB.prepare(
      `SELECT m.domain_id, event.domain_id AS event_domain_id
       FROM messages m
       JOIN webhook_events event ON event.message_id = m.id
       WHERE m.provider_message_id = 'provider-message-2'`,
    ).first<{ domain_id: string; event_domain_id: string }>();
    expect(imported).toEqual({
      domain_id: domainId,
      event_domain_id: domainId,
    });
  });

  it("rejects a provider message from a domain not bound to the connection", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        messageId: "provider-message-3",
        from: "sender@other.example",
        email: "to@example.net",
        subject: "Cross-domain message",
        event: "delivered",
        date: "2026-08-02T12:00:00.000Z",
      }),
    );
    await expect(
      service(fetcher).handle(
        "brevo",
        connectionId,
        request({
          id: 45,
          event: "delivered",
          email: "to@example.net",
          "message-id": "provider-message-3",
          ts_event: 1_800_000_002,
        }),
      ),
    ).rejects.toMatchObject({ code: "WEBHOOK_DOMAIN_NOT_FOUND" });
    const events = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM webhook_events
       WHERE provider_message_id = 'provider-message-3'`,
    ).first<number>("count");
    expect(events).toBe(0);
  });
});
