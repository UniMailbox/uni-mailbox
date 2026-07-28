import {
  DomainError,
  parseProviderKey,
  statusRank,
  type ProviderEvent,
  type ProviderMessageDetail,
  type SafeProviderError,
} from "@unimailbox/contracts";
import { runtimePolicy } from "@unimailbox/config";
import type { AppContext } from "../../app-context";

type WebhookContext = Pick<
  AppContext,
  "env" | "providers" | "credentials" | "logger"
>;

interface ConnectionRow {
  provider_key: string;
  config_json: string;
  encrypted_payload: string;
}

async function digest(value: string): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export class WebhookApplicationService {
  constructor(private readonly context: WebhookContext) {}

  async handle(
    providerKeyValue: string,
    connectionId: string,
    request: Request,
  ): Promise<{ accepted: true; duplicate: boolean }> {
    const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
    const rateKey = `rate:webhook:${connectionId}:${await digest(ip)}`;
    const count = Number.parseInt(
      (await this.context.env.KV.get(rateKey)) ?? "0",
      10,
    );
    if (count >= runtimePolicy.webhookRequestsPerMinute) {
      throw new DomainError(
        "WEBHOOK_RATE_LIMITED",
        "Too many webhook requests",
        429,
      );
    }
    await this.context.env.KV.put(rateKey, String(count + 1), {
      expirationTtl: 60,
    });
    const providerKey = parseProviderKey(providerKeyValue);
    const connection = await this.context.env.DB.prepare(
      `SELECT pc.provider_key, pc.config_json, ec.encrypted_payload
       FROM provider_connections pc
       JOIN encrypted_credentials ec ON ec.id = pc.credential_id
       WHERE pc.id = ? AND pc.provider_key = ? AND pc.status = 'active'`,
    )
      .bind(connectionId, providerKey)
      .first<ConnectionRow>();
    if (!connection) {
      throw new DomainError(
        "WEBHOOK_CONNECTION_NOT_FOUND",
        "Webhook connection not found",
        404,
      );
    }
    const plugin = this.context.providers.get(providerKey);
    if (!plugin.webhook) {
      throw new DomainError(
        "WEBHOOK_CAPABILITY_NOT_CONFIGURED",
        "This provider does not accept webhooks",
        404,
      );
    }
    const rawBody = await request.arrayBuffer();
    const event = await plugin.webhook.verifyWebhook(
      {
        connectionId,
        config: JSON.parse(connection.config_json) as Record<string, unknown>,
        secrets: await this.context.credentials.decrypt(
          connection.encrypted_payload,
        ),
      },
      {
        url: request.url,
        headers: Object.fromEntries(request.headers.entries()),
        rawBody,
      },
    );
    const claim = await this.claim(event);
    if (claim === "completed") {
      return { accepted: true, duplicate: true };
    }
    try {
      const messageId = await this.findOrImport(
        connectionId,
        event,
        plugin.sync,
      );
      await this.applyStatus(event, messageId);
      await this.context.env.DB.batch([
        this.context.env.DB.prepare(
          `INSERT INTO webhook_events (
             id, provider_connection_id, provider_key, event_type,
             provider_message_id, message_id, recipient, mapped_status,
             reason, payload_json
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          crypto.randomUUID(),
          connectionId,
          providerKey,
          event.eventKey.split(":")[1] ?? "unknown",
          event.providerMessageId,
          messageId,
          event.recipient ?? null,
          event.status,
          event.error?.message ?? null,
          JSON.stringify({
            eventKey: event.eventKey,
            occurredAt: event.occurredAt.toISOString(),
          }),
        ),
        this.context.env.DB.prepare(
          `UPDATE webhook_deliveries
           SET processing_status = 'succeeded', lock_token = NULL,
               lock_expires_at = NULL, updated_at = CURRENT_TIMESTAMP
           WHERE provider_connection_id = ? AND event_key = ?`,
        ).bind(connectionId, event.eventKey),
      ]);
      return { accepted: true, duplicate: false };
    } catch (error) {
      const safe = safeError(error);
      await this.context.env.DB.prepare(
        `UPDATE webhook_deliveries
         SET processing_status = 'failed', lock_token = NULL,
             lock_expires_at = NULL, error_message = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE provider_connection_id = ? AND event_key = ?`,
      )
        .bind(safe.message, connectionId, event.eventKey)
        .run();
      throw error;
    }
  }

  private async claim(event: ProviderEvent): Promise<"acquired" | "completed"> {
    const lockToken = crypto.randomUUID();
    const lockExpiresAt = Date.now() + runtimePolicy.webhookLockTtlMs;
    const inserted = await this.context.env.DB.prepare(
      `INSERT INTO webhook_deliveries (
         provider_connection_id, provider_key, event_key, event_time,
         processing_status, attempts, lock_token, lock_expires_at
       ) VALUES (?, ?, ?, ?, 'processing', 1, ?, ?)
       ON CONFLICT(provider_connection_id, event_key) DO NOTHING`,
    )
      .bind(
        event.connectionId,
        event.providerKey,
        event.eventKey,
        event.occurredAt.getTime(),
        lockToken,
        lockExpiresAt,
      )
      .run();
    if (inserted.meta.changes === 1) return "acquired";
    const existing = await this.context.env.DB.prepare(
      `SELECT processing_status, lock_expires_at
       FROM webhook_deliveries
       WHERE provider_connection_id = ? AND event_key = ?`,
    )
      .bind(event.connectionId, event.eventKey)
      .first<{ processing_status: string; lock_expires_at: number | null }>();
    if (
      existing?.processing_status === "succeeded" ||
      existing?.processing_status === "ignored"
    ) {
      return "completed";
    }
    const takeover = await this.context.env.DB.prepare(
      `UPDATE webhook_deliveries
       SET processing_status = 'processing', attempts = attempts + 1,
           lock_token = ?, lock_expires_at = ?, error_message = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE provider_connection_id = ? AND event_key = ?
         AND (
           processing_status = 'failed'
           OR lock_expires_at IS NULL
           OR lock_expires_at < ?
         )`,
    )
      .bind(
        lockToken,
        lockExpiresAt,
        event.connectionId,
        event.eventKey,
        Date.now(),
      )
      .run();
    if (takeover.meta.changes !== 1) {
      throw new DomainError(
        "WEBHOOK_BUSY",
        "The webhook event is being processed",
        503,
      );
    }
    return "acquired";
  }

  private async findOrImport(
    connectionId: string,
    event: ProviderEvent,
    sync:
      | {
          getMessage(
            context: {
              connectionId: string;
              config: Readonly<Record<string, unknown>>;
              secrets: Readonly<Record<string, string>>;
            },
            providerMessageId: string,
          ): Promise<ProviderMessageDetail>;
        }
      | undefined,
  ): Promise<string> {
    const known = await this.context.env.DB.prepare(
      `SELECT id FROM messages
       WHERE provider_connection_id = ? AND provider_message_id = ?`,
    )
      .bind(connectionId, event.providerMessageId)
      .first<{ id: string }>();
    if (known) return known.id;
    if (!sync) {
      throw new DomainError(
        "PROVIDER_MESSAGE_NOT_FOUND",
        "The provider message is not known and cannot be imported",
        404,
      );
    }
    const stateLock = crypto.randomUUID();
    const acquired = await this.context.env.DB.prepare(
      `INSERT INTO provider_message_state (
         provider_connection_id, provider_key, provider_message_id,
         status_event_time, status_rank, import_lock_token,
         import_lock_expires_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(provider_connection_id, provider_message_id) DO UPDATE SET
         import_lock_token = excluded.import_lock_token,
         import_lock_expires_at = excluded.import_lock_expires_at
       WHERE provider_message_state.message_id IS NULL
         AND (
           provider_message_state.import_lock_expires_at IS NULL
           OR provider_message_state.import_lock_expires_at < ?
         )`,
    )
      .bind(
        connectionId,
        event.providerKey,
        event.providerMessageId,
        event.occurredAt.getTime(),
        statusRank[event.status],
        stateLock,
        Date.now() + runtimePolicy.webhookLockTtlMs,
        Date.now(),
      )
      .run();
    if (acquired.meta.changes !== 1) {
      const resolved = await this.context.env.DB.prepare(
        `SELECT message_id FROM provider_message_state
         WHERE provider_connection_id = ? AND provider_message_id = ?`,
      )
        .bind(connectionId, event.providerMessageId)
        .first<{ message_id: string | null }>();
      if (resolved?.message_id) return resolved.message_id;
      throw new DomainError(
        "PROVIDER_IMPORT_BUSY",
        "The provider message is being imported",
        503,
      );
    }
    const connection = await this.context.env.DB.prepare(
      `SELECT pc.config_json, ec.encrypted_payload
       FROM provider_connections pc
       JOIN encrypted_credentials ec ON ec.id = pc.credential_id
       WHERE pc.id = ?`,
    )
      .bind(connectionId)
      .first<{ config_json: string; encrypted_payload: string }>();
    if (!connection) {
      throw new DomainError(
        "PROVIDER_CONNECTION_NOT_FOUND",
        "Provider connection not found",
        404,
      );
    }
    const detail = await sync.getMessage(
      {
        connectionId,
        config: JSON.parse(connection.config_json) as Record<string, unknown>,
        secrets: await this.context.credentials.decrypt(
          connection.encrypted_payload,
        ),
      },
      event.providerMessageId,
    );
    const messageId = crypto.randomUUID();
    try {
      await this.context.env.DB.batch([
        this.context.env.DB.prepare(
          `INSERT INTO messages (
             id, thread_id, from_address, from_name, subject, html_body,
             text_body, provider_key, provider_connection_id,
             provider_message_id, status, sent_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          messageId,
          messageId,
          detail.from.address,
          detail.from.name ?? "",
          detail.subject,
          detail.html,
          detail.text,
          event.providerKey,
          connectionId,
          event.providerMessageId,
          detail.status,
          detail.occurredAt.replace("T", " ").replace("Z", ""),
        ),
        this.context.env.DB.prepare(
          `UPDATE provider_message_state
           SET message_id = ?, import_lock_token = NULL,
               import_lock_expires_at = NULL, updated_at = CURRENT_TIMESTAMP
           WHERE provider_connection_id = ? AND provider_message_id = ?
             AND import_lock_token = ?`,
        ).bind(messageId, connectionId, event.providerMessageId, stateLock),
      ]);
      return messageId;
    } catch {
      const raced = await this.context.env.DB.prepare(
        `SELECT id FROM messages
         WHERE provider_connection_id = ? AND provider_message_id = ?`,
      )
        .bind(connectionId, event.providerMessageId)
        .first<{ id: string }>();
      if (raced) return raced.id;
      throw new DomainError(
        "PROVIDER_IMPORT_FAILED",
        "The provider message could not be imported",
        502,
      );
    }
  }

  private async applyStatus(
    event: ProviderEvent,
    messageId: string,
  ): Promise<void> {
    const rank = statusRank[event.status];
    await this.context.env.DB.batch([
      this.context.env.DB.prepare(
        `INSERT INTO provider_message_state (
           provider_connection_id, provider_key, provider_message_id,
           message_id, status_event_time, status_rank
         ) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(provider_connection_id, provider_message_id) DO UPDATE SET
           message_id = COALESCE(provider_message_state.message_id, excluded.message_id),
           status_event_time = excluded.status_event_time,
           status_rank = excluded.status_rank,
           updated_at = CURRENT_TIMESTAMP
         WHERE provider_message_state.status_event_time IS NULL
           OR excluded.status_event_time > provider_message_state.status_event_time
           OR (
             excluded.status_event_time = provider_message_state.status_event_time
             AND excluded.status_rank >= provider_message_state.status_rank
           )`,
      ).bind(
        event.connectionId,
        event.providerKey,
        event.providerMessageId,
        messageId,
        event.occurredAt.getTime(),
        rank,
      ),
      this.context.env.DB.prepare(
        `UPDATE messages
         SET status = ?, error_code = ?, error_message = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND EXISTS (
           SELECT 1 FROM provider_message_state state
           WHERE state.provider_connection_id = ?
             AND state.provider_message_id = ?
             AND state.status_event_time = ?
             AND state.status_rank = ?
         )`,
      ).bind(
        event.status,
        event.error?.code ?? null,
        event.error?.message ?? null,
        messageId,
        event.connectionId,
        event.providerMessageId,
        event.occurredAt.getTime(),
        rank,
      ),
    ]);
  }
}

function safeError(error: unknown): SafeProviderError {
  return {
    code: error instanceof DomainError ? error.code : "WEBHOOK_FAILED",
    message:
      error instanceof DomainError
        ? error.message
        : "Webhook processing failed",
    retryable: !(error instanceof DomainError && error.status < 500),
    category: "provider",
  };
}
