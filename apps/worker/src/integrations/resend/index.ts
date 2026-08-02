import {
  DomainError,
  RESEND_PROVIDER_KEY,
  type MailAddress,
  type MessageStatus,
  type ProviderAttachment,
  type ProviderEvent,
  type ProviderMessageDetail,
  type ProviderPlugin,
  type ProviderRuntimeContext,
  type ProviderWebhookRequest,
  type SafeProviderError,
  type SendProviderMessage,
} from "@unimailbox/contracts";
import { Webhook } from "svix";
import { z } from "zod";

const ResendConnectionSchema = z.object({
  apiKey: z.string().min(8),
  webhookSecret: z.string().min(8),
});

type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

function requireSecrets(context: ProviderRuntimeContext): {
  apiKey: string;
  webhookSecret: string;
} {
  return ResendConnectionSchema.parse(context.secrets);
}

function address(value: MailAddress): string {
  return value.name?.trim()
    ? `${value.name.trim()} <${value.address}>`
    : value.address;
}

function attachmentContent(attachment: ProviderAttachment): string {
  const bytes = new Uint8Array(attachment.content);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function toResendPayload(message: SendProviderMessage) {
  return {
    from: address(message.from),
    to: message.to.map(address),
    ...(message.cc.length > 0 ? { cc: message.cc.map(address) } : {}),
    ...(message.bcc.length > 0 ? { bcc: message.bcc.map(address) } : {}),
    subject: message.subject,
    html: message.html,
    text: message.text,
    ...(message.messageId || message.inReplyTo || message.references
      ? {
          headers: {
            ...(message.messageId ? { "Message-ID": message.messageId } : {}),
            ...(message.inReplyTo ? { "In-Reply-To": message.inReplyTo } : {}),
            ...(message.references ? { References: message.references } : {}),
          },
        }
      : {}),
    ...(message.attachments.length > 0
      ? {
          attachments: message.attachments.map((attachment) => ({
            filename: attachment.filename ?? "attachment",
            content: attachmentContent(attachment),
          })),
        }
      : {}),
  };
}

async function jsonOrEmpty(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {};
  }
}

function toSafeError(status: number, body: unknown): SafeProviderError {
  const message =
    body &&
    typeof body === "object" &&
    "message" in body &&
    typeof body.message === "string"
      ? body.message
      : "Resend request failed";
  if (status === 401 || status === 403) {
    return {
      code: "RESEND_AUTHENTICATION_FAILED",
      message,
      retryable: false,
      category: "authentication",
    };
  }
  if (status === 429) {
    return {
      code: "RESEND_RATE_LIMITED",
      message,
      retryable: true,
      category: "rate_limit",
    };
  }
  if (status >= 400 && status < 500) {
    return {
      code: "RESEND_INVALID_PAYLOAD",
      message,
      retryable: false,
      category: "invalid_payload",
    };
  }
  return {
    code: "RESEND_UNAVAILABLE",
    message,
    retryable: true,
    category: "provider",
  };
}

const statusByEvent: Readonly<Record<string, MessageStatus>> = {
  "email.scheduled": "queued",
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.delivery_delayed": "delayed",
  "email.opened": "delivered",
  "email.clicked": "delivered",
  "email.bounced": "bounced",
  "email.suppressed": "bounced",
  "email.complained": "complained",
  "email.failed": "failed",
};

function parseAddress(value: unknown): MailAddress {
  if (typeof value !== "string") return { address: "unknown@invalid" };
  const match = value.match(/^\s*(.*?)\s*<([^<>]+)>\s*$/u);
  return match
    ? {
        address: match[2]!.toLowerCase(),
        ...(match[1] ? { name: match[1] } : {}),
      }
    : { address: value.trim().toLowerCase() };
}

function addressList(value: unknown): MailAddress[] {
  return Array.isArray(value) ? value.map(parseAddress) : [];
}

function mapStatus(value: unknown): MessageStatus {
  return statusByEvent[`email.${String(value ?? "sent")}`] ?? "sent";
}

function mapMessage(value: unknown): ProviderMessageDetail {
  const result = z
    .object({
      id: z.string().min(1),
      from: z.string().min(1),
      to: z.array(z.string()),
      cc: z.array(z.string()).nullish(),
      bcc: z.array(z.string()).nullish(),
      subject: z.string().default(""),
      html: z.string().nullish(),
      text: z.string().nullish(),
      last_event: z.string().nullish(),
      created_at: z.string().datetime({ offset: true }),
    })
    .safeParse(value);
  if (!result.success) {
    throw new DomainError(
      "RESEND_MESSAGE_INVALID",
      "Resend message detail is invalid",
      502,
    );
  }
  const payload = result.data;
  return {
    providerMessageId: payload.id,
    from: parseAddress(payload.from),
    to: addressList(payload.to),
    cc: addressList(payload.cc ?? []),
    bcc: addressList(payload.bcc ?? []),
    subject: payload.subject,
    html: payload.html ?? "",
    text: payload.text ?? "",
    status: mapStatus(payload.last_event),
    occurredAt: new Date(payload.created_at).toISOString(),
  };
}

function readHeader(
  headers: Readonly<Record<string, string>>,
  name: string,
): string {
  const target = name.toLowerCase();
  return (
    Object.entries(headers).find(
      ([key]) => key.toLowerCase() === target,
    )?.[1] ?? ""
  );
}

function parseWebhook(
  context: ProviderRuntimeContext,
  request: ProviderWebhookRequest,
): ProviderEvent {
  const { webhookSecret } = requireSecrets(context);
  const payloadText = new TextDecoder().decode(request.rawBody);
  let verified: unknown;
  try {
    verified = new Webhook(webhookSecret).verify(payloadText, {
      "svix-id": readHeader(request.headers, "svix-id"),
      "svix-timestamp": readHeader(request.headers, "svix-timestamp"),
      "svix-signature": readHeader(request.headers, "svix-signature"),
    });
  } catch {
    throw new DomainError(
      "WEBHOOK_AUTHENTICATION_FAILED",
      "Webhook authentication failed",
      401,
    );
  }
  const result = z
    .object({
      type: z.string(),
      created_at: z.string().datetime({ offset: true }),
      data: z.object({
        email_id: z.string().min(1),
        to: z.array(z.string()).optional(),
      }),
    })
    .safeParse(verified);
  if (!result.success) {
    throw new DomainError(
      "WEBHOOK_PAYLOAD_INVALID",
      "Webhook payload is invalid",
    );
  }
  const payload = result.data;
  const status = statusByEvent[payload.type];
  if (!status) {
    throw new DomainError(
      "WEBHOOK_EVENT_UNSUPPORTED",
      `Unsupported Resend event ${payload.type}`,
    );
  }
  const eventKey = readHeader(request.headers, "svix-id");
  if (!eventKey) {
    throw new DomainError(
      "WEBHOOK_PAYLOAD_INVALID",
      "Webhook delivery ID is missing",
    );
  }
  return {
    providerKey: RESEND_PROVIDER_KEY,
    connectionId: context.connectionId,
    eventKey,
    eventType: payload.type,
    providerMessageId: payload.data.email_id,
    status,
    occurredAt: new Date(payload.created_at),
    ...(payload.data.to?.[0] ? { recipient: payload.data.to[0] } : {}),
  };
}

export function createResendProviderPlugin(
  fetcher: Fetcher = fetch,
): ProviderPlugin {
  async function request(
    context: ProviderRuntimeContext,
    path: string,
    init: RequestInit = {},
  ): Promise<unknown> {
    const { apiKey } = requireSecrets(context);
    const response = await fetcher(`https://api.resend.com${path}`, {
      ...init,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${apiKey}`,
        ...init.headers,
      },
    });
    const body = await jsonOrEmpty(response);
    if (!response.ok) {
      const safe = toSafeError(response.status, body);
      throw new DomainError(safe.code, safe.message, 502, safe);
    }
    return body;
  }

  return {
    outbound: {
      key: RESEND_PROVIDER_KEY,
      async validateConnection(context) {
        // Resend sending-only keys cannot call account or domain read APIs.
        // Structural validation happens here; the domain test-send endpoint is
        // the authoritative live credential and sender-domain verification.
        requireSecrets(context);
      },
      async send(context, message) {
        const body = await request(context, "/emails", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": message.idempotencyKey,
          },
          body: JSON.stringify(toResendPayload(message)),
        });
        const parsed = z.object({ id: z.string().min(1) }).safeParse(body);
        if (!parsed.success) {
          throw new DomainError(
            "RESEND_RESPONSE_INVALID",
            "Resend did not return a message ID",
            502,
          );
        }
        return {
          providerMessageId: parsed.data.id,
          acceptedAt: new Date().toISOString(),
        };
      },
    },
    webhook: {
      key: RESEND_PROVIDER_KEY,
      async verifyWebhook(context, request) {
        return parseWebhook(context, request);
      },
    },
    sync: {
      key: RESEND_PROVIDER_KEY,
      async getMessage(context, providerMessageId) {
        return mapMessage(
          await request(
            context,
            `/emails/${encodeURIComponent(providerMessageId)}`,
          ),
        );
      },
      async listMessages(context, cursor) {
        const query = cursor
          ? `?limit=100&after=${encodeURIComponent(cursor)}`
          : "?limit=100";
        const body = z
          .object({
            data: z.array(z.unknown()),
            has_more: z.boolean().default(false),
          })
          .parse(await request(context, `/emails${query}`));
        const items = body.data.map(mapMessage);
        return {
          items,
          ...(body.has_more && items.at(-1)
            ? { nextCursor: items.at(-1)!.providerMessageId }
            : {}),
        };
      },
    },
    validateConnectionInput(input) {
      return ResendConnectionSchema.parse(input);
    },
  };
}
