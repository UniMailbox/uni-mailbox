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
  from_address: string;
  from_name: string;
  subject: string;
  html_body: string;
  text_body: string;
  message_id_header: string | null;
  in_reply_to_header: string | null;
  references_header: string;
  provider_key: string;
  provider_connection_id: string;
  config_json: string;
  encrypted_payload: string;
}

interface RecipientRow {
  type: "to" | "cc" | "bcc";
  address: string;
  display_name: string;
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
}> {
  const row = await context.env.DB.prepare(
    `SELECT m.id, m.from_address, m.from_name, m.subject, m.html_body,
            m.text_body, m.message_id_header, m.in_reply_to_header,
            m.references_header, m.provider_key, m.provider_connection_id,
            pc.config_json, ec.encrypted_payload
     FROM messages m
     JOIN provider_connections pc ON pc.id = m.provider_connection_id
     JOIN encrypted_credentials ec ON ec.id = pc.credential_id
     WHERE m.id = ? AND pc.status = 'active'`,
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
  const attachmentRows = await context.env.DB.prepare(
    `SELECT object_key, filename, mime_type, disposition, content_id
     FROM message_attachments
     WHERE message_id = ?`,
  )
    .bind(messageId)
    .all<AttachmentRow>();
  const attachments: ProviderAttachment[] = [];
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
    const message = await loadProviderMessage(context, job.messageId);
    const providerKey = parseProviderKey(message.row.provider_key);
    const plugin = context.providers.get(providerKey);
    const secrets = await context.credentials.decrypt(
      message.row.encrypted_payload,
    );
    const result = await plugin.outbound.send(
      {
        connectionId: message.row.provider_connection_id,
        config: JSON.parse(message.row.config_json) as Record<string, unknown>,
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
    await context.env.DB.batch([
      context.env.DB.prepare(
        `UPDATE messages
         SET status = 'sent', provider_key = ?, provider_message_id = ?,
             sent_at = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      ).bind(
        providerKey,
        result.providerMessageId,
        result.acceptedAt.replace("T", " ").replace("Z", ""),
        job.messageId,
      ),
      context.env.DB.prepare(
        `UPDATE outbound_jobs
         SET status = 'succeeded', lock_token = NULL, lock_expires_at = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND lock_token = ?`,
      ).bind(job.jobId, lockToken),
    ]);
    context.logger.info("outbound.send.completed", {
      messageId: job.messageId,
      providerKey,
      providerMessageId: result.providerMessageId,
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
