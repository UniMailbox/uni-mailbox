import { applyD1Migrations, env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BREVO_PROVIDER_KEY } from "@unimailbox/contracts";
import { createBrevoProviderPlugin } from "../../src/integrations/brevo";
import { ProviderRegistry } from "../../src/integrations/providers";
import { WebhookApplicationService } from "../../src/modules/provider-sync/webhook";
import { CredentialCipher } from "../../src/platform/crypto";

const connectionId = "66666666-6666-4666-8666-666666666666";
const messageId = "77777777-7777-4777-8777-777777777777";
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

function service() {
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
      new Map([[BREVO_PROVIDER_KEY, createBrevoProviderPlugin(vi.fn())]]),
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
        `INSERT INTO messages (
           id, thread_id, from_address, subject, provider_key,
           provider_connection_id, provider_message_id, status
         ) VALUES (?, ?, 'sender@example.com', 'Webhook test', 'brevo',
                   ?, 'provider-message-1', 'sent')`,
      ).bind(messageId, messageId, connectionId),
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
    expect(message?.status).toBe("delivered");
    expect(deliveries).toBe(2);
  });
});
