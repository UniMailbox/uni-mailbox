import { describe, expect, it, vi } from "vitest";
import {
  BREVO_PROVIDER_KEY,
  type ProviderRuntimeContext,
} from "@unimailbox/contracts";
import { createBrevoProviderPlugin } from "../../src/integrations/brevo";

const runtime: ProviderRuntimeContext = {
  connectionId: "connection-1",
  config: {},
  secrets: {
    apiKey: "xkeysib-test",
    webhookSecret: "webhook-test",
  },
};

describe("Brevo outbound adapter", () => {
  it("maps distinct recipient fields, omits empty names, and sends a stable idempotency key", async () => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(body).toMatchObject({
          sender: { email: "sender@example.com" },
          to: [{ email: "to@example.com", name: "To Person" }],
          cc: [{ email: "cc@example.com" }],
          bcc: [{ email: "bcc@example.com" }],
          subject: "Subject",
          headers: { "Idempotency-Key": "message-id" },
        });
        expect(init?.headers).toMatchObject({ "api-key": "xkeysib-test" });
        return Response.json(
          { messageId: "<provider@example.com>" },
          { status: 201 },
        );
      },
    );
    const plugin = createBrevoProviderPlugin(fetcher);

    await expect(
      plugin.outbound.send(runtime, {
        idempotencyKey: "message-id",
        from: { address: "sender@example.com", name: "" },
        to: [{ address: "to@example.com", name: "To Person" }],
        cc: [{ address: "cc@example.com" }],
        bcc: [{ address: "bcc@example.com", name: "" }],
        subject: "Subject",
        html: "<p>Hello</p>",
        text: "Hello",
        attachments: [],
      }),
    ).resolves.toMatchObject({
      providerMessageId: "<provider@example.com>",
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.brevo.com/v3/smtp/email",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("base64 encodes ordinary attachments", async () => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as {
          attachment: Array<{ name: string; content: string }>;
        };
        expect(body.attachment).toEqual([
          { name: "hello.txt", content: "SGVsbG8=" },
        ]);
        return Response.json({ messageId: "provider-1" }, { status: 201 });
      },
    );
    const plugin = createBrevoProviderPlugin(fetcher);

    await plugin.outbound.send(runtime, {
      idempotencyKey: "message-id",
      from: { address: "sender@example.com" },
      to: [{ address: "to@example.com" }],
      cc: [],
      bcc: [],
      subject: "Subject",
      html: "",
      text: "Hello",
      attachments: [
        {
          filename: "hello.txt",
          contentType: "text/plain",
          disposition: "attachment",
          content: new TextEncoder().encode("Hello").buffer,
        },
      ],
    });
  });
});

describe("Brevo webhook adapter", () => {
  it("authenticates before parsing and maps delivery status", async () => {
    const plugin = createBrevoProviderPlugin(vi.fn());
    const rawBody = new TextEncoder().encode(
      JSON.stringify({
        id: 42,
        event: "delivered",
        email: "to@example.com",
        "message-id": "<provider@example.com>",
        ts_event: 1_800_000_000,
      }),
    ).buffer;

    await expect(
      plugin.webhook?.verifyWebhook(runtime, {
        url: "https://mail.example/api/v1/webhooks/brevo/connection-1",
        headers: { authorization: "Bearer webhook-test" },
        rawBody,
      }),
    ).resolves.toMatchObject({
      providerKey: BREVO_PROVIDER_KEY,
      connectionId: "connection-1",
      eventKey: "42:delivered:<provider@example.com>:1800000000",
      providerMessageId: "<provider@example.com>",
      status: "delivered",
      recipient: "to@example.com",
    });

    await expect(
      plugin.webhook?.verifyWebhook(runtime, {
        url: "https://mail.example/api/v1/webhooks/brevo/connection-1",
        headers: { authorization: "Bearer wrong" },
        rawBody: new TextEncoder().encode("not-json").buffer,
      }),
    ).rejects.toMatchObject({
      code: "WEBHOOK_AUTHENTICATION_FAILED",
      status: 401,
    });
  });
});
