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
import { enforceRateLimit, rateLimitRules } from "../../platform/rate-limit";

type WebhookContext = Pick<
  AppContext,
  "env" | "providers" | "credentials" | "logger"
>;

interface ConnectionRow {
  provider_key: string;
  config_json: string;
  encrypted_payload: string;
}

interface ResolvedMessage {
  messageId: string;
  domainId: string;
}

function domainName(address: string): string | null {
  const separator = address.lastIndexOf("@");
  return separator > 0 && separator < address.length - 1
    ? address
        .slice(separator + 1)
        .trim()
        .toLowerCase()
    : null;
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
    // Per-(connection, IP) per-minute window — the index is encoded in the
    // key so each window is a distinct KV entry and a busy connection can
    // never keep its counter alive past the window boundary.
    await enforceRateLimit(
      this.context.env.KV,
      rateLimitRules.webhook,
      `${connectionId}:${await digest(ip)}`,
    );
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
      // Final-state event already processed in a previous request; the
      // provider expects us to ack without re-running the import.
      return { accepted: true, duplicate: true };
    }
    try {
      const resolved = await this.findOrImport(
        connectionId,
        event,
        plugin.sync,
      );
      await this.applyStatus(event, resolved);
      await this.context.env.DB.batch([
        this.context.env.DB.prepare(
          `INSERT INTO webhook_events (
             id, domain_id, provider_connection_id, provider_key, event_type,
             provider_message_id, message_id, recipient, mapped_status,
             reason, payload_json
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          crypto.randomUUID(),
          resolved.domainId,
          connectionId,
          providerKey,
          event.eventType,
          event.providerMessageId,
          resolved.messageId,
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
           SET domain_id = ?, processing_status = 'succeeded', lock_token = NULL,
               lock_expires_at = NULL, updated_at = CURRENT_TIMESTAMP
           WHERE provider_connection_id = ? AND event_key = ?`,
        ).bind(resolved.domainId, connectionId, event.eventKey),
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
    // Single-event idempotency: each (connection, eventKey) only inserts
    // once; concurrent re-deliveries from the provider fall into the
    // existing-row branch below instead of duplicating work.
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
      // Final states short-circuit immediately: replays must not retrigger
      // import or status updates against a row that already settled.
      return "completed";
    }
    // Takeover: the row exists but is either still 'processing' with a stale
    // lock, or it failed earlier. We only claim when the previous attempt is
    // demonstrably safe to retry; anything else returns 0 changes and the
    // caller surfaces WEBHOOK_BUSY.
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
  ): Promise<ResolvedMessage> {
    const known = await this.context.env.DB.prepare(
      `SELECT m.id, COALESCE(m.domain_id, mb.domain_id) AS domain_id,
              m.from_address
       FROM messages m
       LEFT JOIN mailbox_messages mm ON mm.message_id = m.id
       LEFT JOIN mailboxes mb ON mb.id = mm.mailbox_id
       WHERE provider_connection_id = ? AND provider_message_id = ?
       ORDER BY CASE mm.folder WHEN 'sent' THEN 0 ELSE 1 END`,
    )
      .bind(connectionId, event.providerMessageId)
      .first<{ id: string; domain_id: string | null; from_address: string }>();
    if (known) {
      const domainId =
        known.domain_id ??
        (await this.resolveDomain(connectionId, known.from_address, false));
      await this.context.env.DB.prepare(
        "UPDATE messages SET domain_id = ? WHERE id = ? AND domain_id IS NULL",
      )
        .bind(domainId, known.id)
        .run();
      return { messageId: known.id, domainId };
    }
    if (!sync) {
      throw new DomainError(
        "PROVIDER_MESSAGE_NOT_FOUND",
        "The provider message is not known and cannot be imported",
        404,
      );
    }
    const stateLock = crypto.randomUUID();
    // `provider_message_state` doubles as the "have we imported this yet?"
    // gate. The row is created (or re-locked) only when no final message has
    // been linked yet, so a webhook for a message we already imported can
    // short-circuit straight into status update.
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
      if (resolved?.message_id) {
        const message = await this.context.env.DB.prepare(
          "SELECT domain_id FROM messages WHERE id = ?",
        )
          .bind(resolved.message_id)
          .first<{ domain_id: string | null }>();
        if (message?.domain_id) {
          return {
            messageId: resolved.message_id,
            domainId: message.domain_id,
          };
        }
      }
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
    const domainId = await this.resolveDomain(
      connectionId,
      detail.from.address,
      true,
    );
    const messageId = crypto.randomUUID();
    try {
      await this.context.env.DB.batch([
        this.context.env.DB.prepare(
          `INSERT INTO messages (
             id, domain_id, thread_id, from_address, from_name, subject, html_body,
             text_body, provider_key, provider_connection_id,
             provider_message_id, status, sent_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          messageId,
          domainId,
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
           SET message_id = ?, domain_id = ?, import_lock_token = NULL,
               import_lock_expires_at = NULL, updated_at = CURRENT_TIMESTAMP
           WHERE provider_connection_id = ? AND provider_message_id = ?
             AND import_lock_token = ?`,
        ).bind(
          messageId,
          domainId,
          connectionId,
          event.providerMessageId,
          stateLock,
        ),
      ]);
      return { messageId, domainId };
    } catch {
      const raced = await this.context.env.DB.prepare(
        `SELECT id FROM messages
         WHERE provider_connection_id = ? AND provider_message_id = ?`,
      )
        .bind(connectionId, event.providerMessageId)
        .first<{ id: string }>();
      if (raced) {
        return { messageId: raced.id, domainId };
      }
      throw new DomainError(
        "PROVIDER_IMPORT_FAILED",
        "The provider message could not be imported",
        502,
      );
    }
  }

  private async resolveDomain(
    connectionId: string,
    fromAddress: string,
    requireCurrentBinding: boolean,
  ): Promise<string> {
    const name = domainName(fromAddress);
    const domain = name
      ? await this.context.env.DB.prepare(
          `SELECT id FROM domains
           WHERE name = ? COLLATE NOCASE
             ${requireCurrentBinding ? "AND outbound_connection_id = ?" : ""}
           LIMIT 1`,
        )
          .bind(...(requireCurrentBinding ? [name, connectionId] : [name]))
          .first<{ id: string }>()
      : null;
    if (!domain) {
      throw new DomainError(
        "WEBHOOK_DOMAIN_NOT_FOUND",
        "The provider message does not belong to a domain bound to this connection",
        409,
      );
    }
    return domain.id;
  }

  private async applyStatus(
    event: ProviderEvent,
    resolved: ResolvedMessage,
  ): Promise<void> {
    const rank = statusRank[event.status];
    // The ON CONFLICT guard keeps events monotonic: a later event_time always
    // wins; a same-instant event only wins when its status rank is at least
    // as high, so re-ordered deliveries can never demote a more advanced
    // state. This is the contract `statusRank` and the status-ordering tests
    // protect.
    await this.context.env.DB.batch([
      this.context.env.DB.prepare(
        `INSERT INTO provider_message_state (
           provider_connection_id, provider_key, provider_message_id,
           message_id, domain_id, status_event_time, status_rank
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(provider_connection_id, provider_message_id) DO UPDATE SET
           message_id = COALESCE(provider_message_state.message_id, excluded.message_id),
           domain_id = COALESCE(provider_message_state.domain_id, excluded.domain_id),
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
        resolved.messageId,
        resolved.domainId,
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
        resolved.messageId,
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
