import type { MessageStatus, ProviderKey } from "../domain";

export interface MailAddress {
  address: string;
  name?: string;
}

export interface ProviderAttachment {
  filename: string | null;
  contentType: string;
  disposition: "attachment" | "inline";
  contentId?: string;
  content: ArrayBuffer;
}

export interface SendProviderMessage {
  idempotencyKey: string;
  from: MailAddress;
  to: MailAddress[];
  cc: MailAddress[];
  bcc: MailAddress[];
  subject: string;
  html: string;
  text: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string;
  attachments: ProviderAttachment[];
}

export interface ProviderSendResult {
  providerMessageId: string;
  acceptedAt: string;
}

export interface SafeProviderError {
  code: string;
  message: string;
  retryable: boolean;
  category:
    | "authentication"
    | "rate_limit"
    | "invalid_payload"
    | "provider"
    | "unknown";
}

export interface ProviderEvent {
  providerKey: ProviderKey;
  connectionId: string;
  eventKey: string;
  providerMessageId: string;
  status: MessageStatus;
  occurredAt: Date;
  recipient?: string;
  error?: SafeProviderError;
}

export interface ProviderRuntimeContext {
  connectionId: string;
  config: Readonly<Record<string, unknown>>;
  secrets: Readonly<Record<string, string>>;
}

export interface ProviderWebhookRequest {
  url: string;
  headers: Readonly<Record<string, string>>;
  rawBody: ArrayBuffer;
}

export interface ProviderMessageDetail {
  providerMessageId: string;
  from: MailAddress;
  to: MailAddress[];
  cc: MailAddress[];
  bcc: MailAddress[];
  subject: string;
  html: string;
  text: string;
  status: MessageStatus;
  occurredAt: string;
}

export interface ProviderMessagePage {
  items: ProviderMessageDetail[];
  nextCursor?: string;
}

export interface OutboundProviderAdapter {
  readonly key: ProviderKey;
  validateConnection(context: ProviderRuntimeContext): Promise<void>;
  send(
    context: ProviderRuntimeContext,
    message: SendProviderMessage,
  ): Promise<ProviderSendResult>;
}

export interface WebhookProviderAdapter {
  readonly key: ProviderKey;
  verifyWebhook(
    context: ProviderRuntimeContext,
    request: ProviderWebhookRequest,
  ): Promise<ProviderEvent>;
}

export interface SyncProviderAdapter {
  readonly key: ProviderKey;
  getMessage(
    context: ProviderRuntimeContext,
    providerMessageId: string,
  ): Promise<ProviderMessageDetail>;
  listMessages(
    context: ProviderRuntimeContext,
    cursor?: string,
  ): Promise<ProviderMessagePage>;
}

export interface ProviderPlugin {
  outbound: OutboundProviderAdapter;
  webhook?: WebhookProviderAdapter;
  sync?: SyncProviderAdapter;
  validateConnectionInput(input: unknown): unknown;
}
