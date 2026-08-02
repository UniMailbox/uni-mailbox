import {
  BREVO_PROVIDER_KEY,
  DomainError,
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
import { z } from "zod";

const BrevoConnectionSchema = z.object({
  apiKey: z.string().min(8),
  webhookSecret: z.string().min(8),
});

type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

function compactAddress(address: MailAddress): {
  email: string;
  name?: string;
} {
  return {
    email: address.address,
    ...(address.name?.trim() ? { name: address.name.trim() } : {}),
  };
}

function attachmentContent(attachment: ProviderAttachment): string {
  const bytes = new Uint8Array(attachment.content);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function toBrevoPayload(message: SendProviderMessage) {
  return {
    sender: compactAddress(message.from),
    to: message.to.map(compactAddress),
    ...(message.cc.length > 0 ? { cc: message.cc.map(compactAddress) } : {}),
    ...(message.bcc.length > 0 ? { bcc: message.bcc.map(compactAddress) } : {}),
    subject: message.subject,
    ...(message.html ? { htmlContent: message.html } : {}),
    ...(message.text ? { textContent: message.text } : {}),
    headers: {
      "Idempotency-Key": message.idempotencyKey,
    },
    ...(message.attachments.length > 0
      ? {
          attachment: message.attachments.map((attachment) => ({
            name: attachment.filename ?? "attachment",
            content: attachmentContent(attachment),
          })),
        }
      : {}),
  };
}

function toSafeError(status: number, body: unknown): SafeProviderError {
  const message =
    body &&
    typeof body === "object" &&
    "message" in body &&
    typeof body.message === "string"
      ? body.message
      : "Brevo request failed";
  if (status === 401 || status === 403) {
    return {
      code: "BREVO_AUTHENTICATION_FAILED",
      message,
      retryable: false,
      category: "authentication",
    };
  }
  if (status === 429) {
    return {
      code: "BREVO_RATE_LIMITED",
      message,
      retryable: true,
      category: "rate_limit",
    };
  }
  if (status >= 400 && status < 500) {
    return {
      code: "BREVO_INVALID_PAYLOAD",
      message,
      retryable: false,
      category: "invalid_payload",
    };
  }
  return {
    code: "BREVO_UNAVAILABLE",
    message,
    retryable: true,
    category: "provider",
  };
}

function requireSecrets(context: ProviderRuntimeContext): {
  apiKey: string;
  webhookSecret: string;
} {
  return BrevoConnectionSchema.parse(context.secrets);
}

function timingSafeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

const eventStatus: Readonly<Record<string, MessageStatus>> = {
  request: "sent",
  delivered: "delivered",
  deferred: "delayed",
  soft_bounce: "bounced",
  hard_bounce: "bounced",
  bounce: "bounced",
  invalid_email: "bounced",
  blocked: "bounced",
  spam: "complained",
  complaint: "complained",
  error: "failed",
};

function readHeader(
  headers: Readonly<Record<string, string>>,
  name: string,
): string | undefined {
  const target = name.toLowerCase();
  return Object.entries(headers).find(
    ([key]) => key.toLowerCase() === target,
  )?.[1];
}

function parseWebhook(
  context: ProviderRuntimeContext,
  request: ProviderWebhookRequest,
): ProviderEvent {
  const { webhookSecret } = requireSecrets(context);
  const authorization = readHeader(request.headers, "authorization") ?? "";
  if (!timingSafeEqual(authorization, `Bearer ${webhookSecret}`)) {
    throw new DomainError(
      "WEBHOOK_AUTHENTICATION_FAILED",
      "Webhook authentication failed",
      401,
    );
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(new TextDecoder().decode(request.rawBody)) as Record<
      string,
      unknown
    >;
  } catch {
    throw new DomainError(
      "WEBHOOK_PAYLOAD_INVALID",
      "Webhook payload is not valid JSON",
    );
  }

  const event = typeof payload.event === "string" ? payload.event : "";
  const messageId =
    typeof payload["message-id"] === "string" ? payload["message-id"] : "";
  const eventTime = typeof payload.ts_event === "number" ? payload.ts_event : 0;
  const status = eventStatus[event];
  if (!status || !messageId || !eventTime) {
    throw new DomainError(
      "WEBHOOK_EVENT_UNSUPPORTED",
      "Webhook event is missing a supported status, message ID, or event time",
    );
  }
  const deliveryId =
    typeof payload.id === "number" || typeof payload.id === "string"
      ? String(payload.id)
      : "unknown";

  return {
    providerKey: BREVO_PROVIDER_KEY,
    connectionId: context.connectionId,
    eventKey: `${deliveryId}:${event}:${messageId}:${eventTime}`,
    eventType: event,
    providerMessageId: messageId,
    status,
    occurredAt: new Date(eventTime * 1000),
    ...(typeof payload.email === "string"
      ? { recipient: payload.email.toLowerCase() }
      : {}),
    ...(typeof payload.reason === "string"
      ? {
          error: {
            code: `BREVO_${event.toUpperCase()}`,
            message: payload.reason,
            retryable: event === "deferred",
            category: "provider",
          } satisfies SafeProviderError,
        }
      : {}),
  };
}

async function jsonOrEmpty(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

export function createBrevoProviderPlugin(
  fetcher: Fetcher = fetch,
): ProviderPlugin {
  return {
    outbound: {
      key: BREVO_PROVIDER_KEY,
      async validateConnection(context) {
        const { apiKey } = requireSecrets(context);
        const response = await fetcher("https://api.brevo.com/v3/account", {
          headers: { accept: "application/json", "api-key": apiKey },
        });
        if (!response.ok) {
          const safe = toSafeError(
            response.status,
            await jsonOrEmpty(response),
          );
          throw new DomainError(safe.code, safe.message, 502, safe);
        }
      },
      async send(context, message) {
        const { apiKey } = requireSecrets(context);
        const response = await fetcher("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            "api-key": apiKey,
          },
          body: JSON.stringify(toBrevoPayload(message)),
        });
        const body = await jsonOrEmpty(response);
        if (!response.ok) {
          const safe = toSafeError(response.status, body);
          throw new DomainError(safe.code, safe.message, 502, safe);
        }
        if (
          !body ||
          typeof body !== "object" ||
          !("messageId" in body) ||
          typeof body.messageId !== "string"
        ) {
          throw new DomainError(
            "BREVO_RESPONSE_INVALID",
            "Brevo did not return a message ID",
            502,
          );
        }
        return {
          providerMessageId: body.messageId,
          acceptedAt: new Date().toISOString(),
        };
      },
    },
    webhook: {
      key: BREVO_PROVIDER_KEY,
      async verifyWebhook(context, request) {
        return parseWebhook(context, request);
      },
    },
    sync: {
      key: BREVO_PROVIDER_KEY,
      async getMessage(context, providerMessageId) {
        const { apiKey } = requireSecrets(context);
        const response = await fetcher(
          `https://api.brevo.com/v3/smtp/emails/${encodeURIComponent(providerMessageId)}`,
          { headers: { accept: "application/json", "api-key": apiKey } },
        );
        if (!response.ok) {
          const safe = toSafeError(
            response.status,
            await jsonOrEmpty(response),
          );
          throw new DomainError(safe.code, safe.message, 502, safe);
        }
        return mapSyncedMessage(await jsonOrEmpty(response));
      },
      async listMessages(context, cursor) {
        const { apiKey } = requireSecrets(context);
        const offset = cursor ? Number.parseInt(cursor, 10) : 0;
        const response = await fetcher(
          `https://api.brevo.com/v3/smtp/statistics/events?limit=100&offset=${Number.isFinite(offset) ? offset : 0}`,
          { headers: { accept: "application/json", "api-key": apiKey } },
        );
        if (!response.ok) {
          const safe = toSafeError(
            response.status,
            await jsonOrEmpty(response),
          );
          throw new DomainError(safe.code, safe.message, 502, safe);
        }
        const body = await jsonOrEmpty(response);
        const events =
          body &&
          typeof body === "object" &&
          "events" in body &&
          Array.isArray(body.events)
            ? body.events
            : [];
        return {
          items: events.map(mapSyncedMessage),
          ...(events.length === 100
            ? { nextCursor: String(offset + 100) }
            : {}),
        };
      },
    },
    validateConnectionInput(input) {
      return BrevoConnectionSchema.parse(input);
    },
  };
}

function mapSyncedMessage(input: unknown): ProviderMessageDetail {
  const value =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  const providerMessageId =
    typeof value.messageId === "string"
      ? value.messageId
      : typeof value["message-id"] === "string"
        ? value["message-id"]
        : "";
  if (!providerMessageId) {
    throw new DomainError(
      "BREVO_MESSAGE_INVALID",
      "Brevo message detail is missing its provider ID",
      502,
    );
  }
  const status =
    typeof value.event === "string" && eventStatus[value.event]
      ? eventStatus[value.event]
      : "sent";
  const recipient =
    typeof value.email === "string" ? [{ address: value.email }] : [];
  return {
    providerMessageId,
    from: {
      address: typeof value.from === "string" ? value.from : "unknown@invalid",
    },
    to: recipient,
    cc: [],
    bcc: [],
    subject: typeof value.subject === "string" ? value.subject : "",
    html: typeof value.htmlContent === "string" ? value.htmlContent : "",
    text: typeof value.textContent === "string" ? value.textContent : "",
    status,
    occurredAt:
      typeof value.date === "string" ? value.date : new Date().toISOString(),
  };
}
