import {
  DomainError,
  parseProviderKey,
  type MailAddress,
  type ProviderAttachment,
  type SafeProviderError,
} from "@unimailbox/contracts";
import { runtimePolicy } from "@unimailbox/config";
import type { AppContext } from "../../app-context";
import type { OutboundMailJob } from "../../platform/config";

type OutboundContext = Pick<
  AppContext,
  "env" | "providers" | "credentials" | "logger" | "attachmentStore"
>;

interface JobRow {
  id: string;
  message_id: string;
  attempts: number;
}

interface ProviderMessageRow {
  id: string;
  status: string;
  from_address: string;
  from_name: string;
  subject: string;
  html_body: string;
  text_body: string;
  message_id_header: string | null;
  in_reply_to_header: string | null;
  references_header: string;
  provider_key: string | null;
  provider_connection_id: string | null;
  config_json: string | null;
  encrypted_payload: string | null;
}

interface RecipientRow {
  type: "to" | "cc" | "bcc";
  address: string;
  display_name: string;
}

interface InternalMailboxRow {
  id: string;
}

interface AttachmentRow {
  object_key: string;
  filename: string | null;
  mime_type: string;
  disposition: "attachment" | "inline";
  content_id: string | null;
}

export class OutboundJobService {
  constructor(private readonly context: OutboundContext) {}

  async dispatch(jobId: string): Promise<void> {
    const job = await this.context.env.DB.prepare(
      `SELECT id, message_id, attempts
       FROM outbound_jobs
       WHERE id = ? AND status = 'pending' AND available_at <= CURRENT_TIMESTAMP`,
    )
      .bind(jobId)
      .first<JobRow>();
    if (!job) return;
    await this.context.env.OUTBOUND_QUEUE.send({
      jobId: job.id,
      messageId: job.message_id,
    });
    await this.context.env.DB.prepare(
      `UPDATE outbound_jobs
       SET status = 'enqueued', updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'pending'`,
    )
      .bind(job.id)
      .run();
  }

  async dispatchPending(limit = 100): Promise<void> {
    const result = await this.context.env.DB.prepare(
      `SELECT id, message_id, attempts
       FROM outbound_jobs
       WHERE status = 'pending' AND available_at <= CURRENT_TIMESTAMP
       ORDER BY available_at, id
       LIMIT ?`,
    )
      .bind(limit)
      .all<JobRow>();
    for (const job of result.results) {
      await this.dispatch(job.id);
    }
  }
}

function safeFailure(error: unknown): SafeProviderError {
  if (
    error instanceof DomainError &&
    error.details &&
    typeof error.details === "object" &&
    "retryable" in error.details
  ) {
    return error.details as SafeProviderError;
  }
  return {
    code: error instanceof DomainError ? error.code : "OUTBOUND_SEND_FAILED",
    message:
      error instanceof DomainError ? error.message : "Outbound delivery failed",
    retryable: !(error instanceof DomainError && error.status < 500),
    category: "unknown",
  };
}

async function loadProviderMessage(
  context: OutboundContext,
  messageId: string,
): Promise<{
  row: ProviderMessageRow;
  to: MailAddress[];
  cc: MailAddress[];
  bcc: MailAddress[];
  attachments: ProviderAttachment[];
  internalMailboxIds: string[];
}> {
  const row = await context.env.DB.prepare(
    `SELECT m.id, m.status, m.from_address, m.from_name, m.subject,
            m.html_body, m.text_body, m.message_id_header,
            m.in_reply_to_header, m.references_header, m.provider_key,
            m.provider_connection_id, pc.config_json, ec.encrypted_payload
     FROM messages m
     LEFT JOIN provider_connections pc
       ON pc.id = m.provider_connection_id AND pc.status = 'active'
     LEFT JOIN encrypted_credentials ec ON ec.id = pc.credential_id
     WHERE m.id = ?`,
  )
    .bind(messageId)
    .first<ProviderMessageRow>();
  if (!row) {
    throw new DomainError(
      "OUTBOUND_MESSAGE_NOT_FOUND",
      "The queued message or provider connection is unavailable",
      404,
    );
  }
  const recipients = await context.env.DB.prepare(
    `SELECT r.type, r.address, r.display_name
     FROM message_recipients r
     LEFT JOIN mailboxes mb
       ON mb.address = r.address COLLATE NOCASE AND mb.status = 'active'
     WHERE r.message_id = ? AND mb.id IS NULL
     ORDER BY r.rowid`,
  )
    .bind(messageId)
    .all<RecipientRow>();
  const internalMailboxes = await context.env.DB.prepare(
    `SELECT DISTINCT mb.id
     FROM message_recipients r
     JOIN mailboxes mb
       ON mb.address = r.address COLLATE NOCASE AND mb.status = 'active'
     WHERE r.message_id = ?`,
  )
    .bind(messageId)
    .all<InternalMailboxRow>();
  const hasExternal = recipients.results.length > 0;
  if (
    hasExternal &&
    (!row.provider_key ||
      !row.provider_connection_id ||
      !row.config_json ||
      !row.encrypted_payload)
  ) {
    throw new DomainError(
      "OUTBOUND_MESSAGE_NOT_FOUND",
      "The queued message or provider connection is unavailable",
      404,
    );
  }
  const attachments: ProviderAttachment[] = [];
  if (hasExternal) {
    const attachmentRows = await context.env.DB.prepare(
      `SELECT object_key, filename, mime_type, disposition, content_id
       FROM message_attachments
       WHERE message_id = ?`,
    )
      .bind(messageId)
      .all<AttachmentRow>();
    for (const attachment of attachmentRows.results) {
      const object = await context.attachmentStore.get(attachment.object_key);
      if (!object) {
        throw new DomainError(
          "ATTACHMENT_OBJECT_MISSING",
          "An attachment object is missing",
          503,
        );
      }
      const bytes =
        object.body instanceof Uint8Array
          ? object.body
          : object.body instanceof ArrayBuffer
            ? new Uint8Array(object.body)
            : new Uint8Array(await new Response(object.body).arrayBuffer());
      attachments.push({
        filename: attachment.filename,
        contentType: attachment.mime_type,
        disposition: attachment.disposition,
        ...(attachment.content_id ? { contentId: attachment.content_id } : {}),
        content: bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer,
      });
    }
  }
  const addresses = (type: RecipientRow["type"]): MailAddress[] =>
    recipients.results
      .filter((recipient) => recipient.type === type)
      .map((recipient) => ({
        address: recipient.address,
        ...(recipient.display_name ? { name: recipient.display_name } : {}),
      }));
  return {
    row,
    to: addresses("to"),
    cc: addresses("cc"),
    bcc: addresses("bcc"),
    attachments,
    internalMailboxIds: internalMailboxes.results.map((mailbox) => mailbox.id),
  };
}

export async function processOutboundJob(
  context: OutboundContext,
  job: OutboundMailJob,
): Promise<void> {
  const lockToken = crypto.randomUUID();
  const lockExpiresAt = Date.now() + runtimePolicy.outboundLockTtlMs;
  // Only claim rows that are pending/enqueued, due now, and not currently
  // owned by another worker. A row that is already 'processing' with a live
  // lock is left alone — that worker's heartbeat owns the recovery path.
  const claim = await context.env.DB.prepare(
    `UPDATE outbound_jobs
     SET status = 'processing', attempts = attempts + 1,
         lock_token = ?, lock_expires_at = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND message_id = ?
       AND status IN ('pending', 'enqueued')
       AND available_at <= CURRENT_TIMESTAMP
       AND (lock_expires_at IS NULL OR lock_expires_at < ?)`,
  )
    .bind(lockToken, lockExpiresAt, job.jobId, job.messageId, Date.now())
    .run();
  if (claim.meta.changes !== 1) return;

  try {
    const outboundRow = await context.env.DB.prepare(
      `SELECT created_via_schedule FROM outbound_jobs WHERE id = ?`,
    )
      .bind(job.jobId)
      .first<{ created_via_schedule: number | null }>();
    const scheduled = (outboundRow?.created_via_schedule ?? 0) === 1;
    const message = await loadProviderMessage(context, job.messageId);
    let providerKey: string | null = null;
    let providerMessageId: string | null = null;
    let acceptedAt: string | null = null;
    if (
      message.to.length > 0 ||
      message.cc.length > 0 ||
      message.bcc.length > 0
    ) {
      if (
        !message.row.provider_key ||
        !message.row.provider_connection_id ||
        !message.row.config_json ||
        !message.row.encrypted_payload
      ) {
        throw new DomainError(
          "OUTBOUND_MESSAGE_NOT_FOUND",
          "The queued message or provider connection is unavailable",
          404,
        );
      }
      const parsedProviderKey = parseProviderKey(message.row.provider_key);
      const plugin = context.providers.get(parsedProviderKey);
      const secrets = await context.credentials.decrypt(
        message.row.encrypted_payload,
      );
      const result = await plugin.outbound.send(
        {
          connectionId: message.row.provider_connection_id,
          config: JSON.parse(message.row.config_json) as Record<
            string,
            unknown
          >,
          secrets,
        },
        {
          idempotencyKey: message.row.id,
          from: {
            address: message.row.from_address,
            ...(message.row.from_name ? { name: message.row.from_name } : {}),
          },
          to: message.to,
          cc: message.cc,
          bcc: message.bcc,
          subject: message.row.subject,
          html: message.row.html_body,
          text: message.row.text_body,
          ...(message.row.message_id_header
            ? { messageId: message.row.message_id_header }
            : {}),
          ...(message.row.in_reply_to_header
            ? { inReplyTo: message.row.in_reply_to_header }
            : {}),
          ...(message.row.references_header
            ? { references: message.row.references_header }
            : {}),
          attachments: message.attachments,
        },
      );
      providerKey = parsedProviderKey;
      providerMessageId = result.providerMessageId;
      acceptedAt = result.acceptedAt;
    }
    await context.env.DB.batch([
      context.env.DB.prepare(
        `UPDATE messages
         SET status = 'sent', provider_key = COALESCE(?, provider_key),
             provider_message_id = COALESCE(?, provider_message_id),
             sent_at = COALESCE(?, CURRENT_TIMESTAMP),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      ).bind(providerKey, providerMessageId, acceptedAt, job.messageId),
      context.env.DB.prepare(
        `UPDATE outbound_jobs
         SET status = 'succeeded', lock_token = NULL, lock_expires_at = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND lock_token = ?`,
      ).bind(job.jobId, lockToken),
      context.env.DB.prepare(
        `UPDATE mailbox_messages
         SET folder = 'sent'
         WHERE message_id = ? AND folder = 'drafts'`,
      ).bind(job.messageId),
      ...message.internalMailboxIds.map((mailboxId) =>
        context.env.DB.prepare(
          `INSERT OR IGNORE INTO mailbox_messages (
             id, mailbox_id, message_id, folder
           ) VALUES (?, ?, ?, 'inbox')`,
        ).bind(crypto.randomUUID(), mailboxId, job.messageId),
      ),
    ]);
    context.logger.info("outbound.send.completed", {
      messageId: job.messageId,
      providerKey,
      providerMessageId,
      scheduled,
    });
  } catch (error) {
    const safe = safeFailure(error);
    const current = await context.env.DB.prepare(
      "SELECT attempts FROM outbound_jobs WHERE id = ? AND lock_token = ?",
    )
      .bind(job.jobId, lockToken)
      .first<{ attempts: number }>();
    const retryable =
      safe.retryable &&
      (current?.attempts ?? runtimePolicy.outboundAttemptLimit) <
        runtimePolicy.outboundAttemptLimit;
    // Exponential backoff capped at 5 minutes (300s) per attempt so a hot
    // message can't pin a worker with ever-shorter retries. `attempts` is
    // incremented atomically by the claim UPDATE, so the floor is always 1
    // for rows that ever entered 'processing'.
    const delaySeconds = Math.min(300, 2 ** (current?.attempts ?? 1));
    await context.env.DB.batch([
      context.env.DB.prepare(
        `UPDATE outbound_jobs
         SET status = ?, available_at = datetime('now', ?),
             lock_token = NULL, lock_expires_at = NULL, last_error = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND lock_token = ?`,
      ).bind(
        retryable ? "pending" : "failed",
        `+${delaySeconds} seconds`,
        JSON.stringify({ code: safe.code, message: safe.message }),
        job.jobId,
        lockToken,
      ),
      ...(!retryable
        ? [
            // Mark the message failed only on the final, non-retryable
            // failure; transient failures keep the message queryable as
            // 'pending' for the next retry.
            context.env.DB.prepare(
              `UPDATE messages
               SET status = 'failed', error_code = ?, error_message = ?,
                   updated_at = CURRENT_TIMESTAMP
               WHERE id = ?`,
            ).bind(safe.code, safe.message, job.messageId),
          ]
        : []),
    ]);
    context.logger.warn("outbound.send.failed", {
      messageId: job.messageId,
      code: safe.code,
      retryable,
    });
    if (retryable) throw error;
  }
}
