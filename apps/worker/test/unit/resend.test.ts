import { describe, expect, it, vi } from "vitest";
import { Webhook } from "svix";
import {
  RESEND_PROVIDER_KEY,
  type ProviderRuntimeContext,
} from "@unimailbox/contracts";
import {
  createResendProviderPlugin,
  toResendPayload,
} from "../../src/integrations/resend";

const webhookSecret = `whsec_${btoa("resend-webhook-secret-32-bytes!!")}`;
const runtime: ProviderRuntimeContext = {
  connectionId: "connection-1",
  config: {},
  secrets: { apiKey: "re_test_key", webhookSecret },
};

describe("Resend provider adapter", () => {
  it("maps outbound messages and uses the provider idempotency header", async () => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.headers).toMatchObject({
          authorization: "Bearer re_test_key",
          "idempotency-key": "message-id",
        });
        expect(JSON.parse(String(init?.body))).toMatchObject({
          from: "Sender <sender@example.com>",
          to: ["to@example.com"],
          subject: "Provider test",
        });
        return Response.json({ id: "resend-message-id" });
      },
    );
    const plugin = createResendProviderPlugin(fetcher);
    await expect(
      plugin.outbound.send(runtime, {
        idempotencyKey: "message-id",
        from: { address: "sender@example.com", name: "Sender" },
        to: [{ address: "to@example.com" }],
        cc: [],
        bcc: [],
        subject: "Provider test",
        html: "<p>Ready</p>",
        text: "Ready",
        attachments: [],
      }),
    ).resolves.toMatchObject({ providerMessageId: "resend-message-id" });
  });

  it("keeps attachment content in the provider payload", () => {
    expect(
      toResendPayload({
        idempotencyKey: "message-id",
        from: { address: "sender@example.com" },
        to: [{ address: "to@example.com" }],
        cc: [],
        bcc: [],
        subject: "Attachment",
        html: "",
        text: "Attachment",
        attachments: [
          {
            filename: "hello.txt",
            contentType: "text/plain",
            disposition: "attachment",
            content: new TextEncoder().encode("Hello").buffer,
          },
        ],
      }).attachments,
    ).toEqual([{ filename: "hello.txt", content: "SGVsbG8=" }]);
  });

  it("verifies raw Svix payloads and maps the Resend event", async () => {
    const plugin = createResendProviderPlugin(vi.fn());
    const payload = JSON.stringify({
      type: "email.delivered",
      created_at: "2026-08-02T12:00:00.000Z",
      data: {
        email_id: "resend-message-id",
        to: ["to@example.com"],
      },
    });
    const id = "msg_123";
    const timestamp = new Date();
    const signature = new Webhook(webhookSecret).sign(id, timestamp, payload);
    await expect(
      plugin.webhook?.verifyWebhook(runtime, {
        url: "https://mail.example/api/v1/webhooks/resend/connection-1",
        headers: {
          "svix-id": id,
          "svix-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
          "svix-signature": signature,
        },
        rawBody: new TextEncoder().encode(payload).buffer,
      }),
    ).resolves.toMatchObject({
      providerKey: RESEND_PROVIDER_KEY,
      eventKey: id,
      eventType: "email.delivered",
      providerMessageId: "resend-message-id",
      status: "delivered",
    });
  });
});
