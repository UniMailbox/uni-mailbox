import {
  DomainError,
  type DraftMessageInput,
  type Principal,
} from "@unimailbox/contracts";
import { normalizeRecipients } from "@unimailbox/email-core";
import type { AppContext } from "../../app-context";
import type { MailboxApplicationService } from "../mailboxes";
import { OutboundJobService } from "../outbound-mail";

interface DraftRow {
  id: string;
  created_by_user_id: string;
  status: string;
  updated_at: string;
  mailbox_id: string;
  domain_id: string;
  address: string;
  display_name: string;
  outbound_connection_id: string | null;
}

interface UploadRow {
  id: string;
  object_key: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  disposition: "attachment" | "inline";
}

function unquote(value: string): string {
  return value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1)
    : value;
}

// A draft "version" is a fresh `updated_at` value that doubles as the
// optimistic-lock token. The ISO timestamp keeps it monotonic per writer and
// the UUID tail prevents two writers in the same millisecond from colliding;
// this combination is what `If-Match` and the WHERE-updated_at guards rely on,
// not a value to display to end users.
function createDraftVersion(): string {
  return `${new Date().toISOString()}#${crypto.randomUUID()}`;
}

export function assertDraftVersion(
  current: string,
  ifMatch: string | undefined,
): void {
  if (!ifMatch) {
    throw new DomainError(
      "DRAFT_VERSION_REQUIRED",
      "An If-Match draft version is required",
      428,
    );
  }
  if (unquote(ifMatch) !== current) {
    throw new DomainError(
      "DRAFT_VERSION_CONFLICT",
      "The draft was modified by another request",
      409,
    );
  }
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(",");
}

function tuples(count: number, width: number): string {
  return Array.from(
    { length: count },
    () => `(${Array.from({ length: width }, () => "?").join(",")})`,
  ).join(",");
}

async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export class DraftApplicationService {
  constructor(
    private readonly context: Pick<
      AppContext,
      "env" | "providers" | "credentials" | "logger" | "attachmentStore"
    >,
    private readonly mailboxes: MailboxApplicationService,
  ) {}

  async create(principal: Principal, input: DraftMessageInput) {
    await this.mailboxes.assert(principal.userId, input.mailboxId, "send");
    const sender = await this.context.env.DB.prepare(
      `SELECT m.id, m.domain_id, m.address, m.display_name
       FROM mailboxes m
       JOIN domains d ON d.id = m.domain_id
       WHERE m.id = ? AND m.status = 'active' AND d.status = 'active'`,
    )
      .bind(input.mailboxId)
      .first<{
        id: string;
        domain_id: string;
        address: string;
        display_name: string;
      }>();
    if (!sender) {
      throw new DomainError(
        "SENDER_MAILBOX_INACTIVE",
        "The sender mailbox or domain is not active",
        409,
      );
    }
    const messageId = crypto.randomUUID();
    const linkId = crypto.randomUUID();
    const recipients = normalizeRecipients(input.to, input.cc, input.bcc);
    const recipientRows = [
      ...recipients.to.map((address) => ["to", address]),
      ...recipients.cc.map((address) => ["cc", address]),
      ...recipients.bcc.map((address) => ["bcc", address]),
    ];
    const uploads = await this.requireUploads(
      principal.userId,
      input.attachmentIds,
    );
    const statements: D1PreparedStatement[] = [
      this.context.env.DB.prepare(
        `INSERT INTO messages (
           id, thread_id, from_address, from_name, subject, html_body, text_body,
           status, created_by_user_id, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?,
                   strftime('%Y-%m-%d %H:%M:%f', 'now'))`,
      ).bind(
        messageId,
        messageId,
        sender.address,
        sender.display_name,
        input.subject,
        input.html,
        input.text,
        principal.userId,
      ),
      this.context.env.DB.prepare(
        `INSERT INTO mailbox_messages (id, mailbox_id, message_id, folder)
         VALUES (?, ?, ?, 'drafts')`,
      ).bind(linkId, sender.id, messageId),
      ...this.recipientInsertStatements(messageId, recipientRows),
      ...this.uploadInsertStatements(messageId, uploads),
    ];
    await this.context.env.DB.batch(statements);
    return this.get(principal, messageId);
  }

  async list(principal: Principal) {
    const result = await this.context.env.DB.prepare(
      `SELECT m.id, mm.mailbox_id, m.subject, m.updated_at, m.created_at,
              m.from_address
       FROM messages m
       JOIN mailbox_messages mm
         ON mm.message_id = m.id AND mm.folder = 'drafts'
       WHERE m.status = 'draft' AND m.created_by_user_id = ?
       ORDER BY m.updated_at DESC, m.id DESC`,
    )
      .bind(principal.userId)
      .all();
    return result.results;
  }

  async get(principal: Principal, draftId: string) {
    const draft = await this.requireDraft(principal.userId, draftId);
    const recipients = await this.context.env.DB.prepare(
      `SELECT type, address, display_name
       FROM message_recipients WHERE message_id = ? ORDER BY rowid`,
    )
      .bind(draftId)
      .all();
    const attachments = await this.context.env.DB.prepare(
      `SELECT id, filename, mime_type, size_bytes, disposition, content_id
       FROM message_attachments WHERE message_id = ?`,
    )
      .bind(draftId)
      .all();
    const content = await this.context.env.DB.prepare(
      `SELECT subject, html_body, text_body, updated_at
       FROM messages WHERE id = ?`,
    )
      .bind(draftId)
      .first();
    return {
      id: draft.id,
      mailboxId: draft.mailbox_id,
      ...content,
      recipients: recipients.results,
      attachments: attachments.results,
    };
  }

  async update(
    principal: Principal,
    draftId: string,
    input: DraftMessageInput,
    ifMatch: string | undefined,
  ) {
    const draft = await this.requireDraft(principal.userId, draftId);
    assertDraftVersion(draft.updated_at, ifMatch);
    if (input.mailboxId !== draft.mailbox_id) {
      throw new DomainError(
        "DRAFT_MAILBOX_IMMUTABLE",
        "A draft sender mailbox cannot be changed",
        409,
      );
    }
    await this.mailboxes.assert(principal.userId, draft.mailbox_id, "send");
    const existingAttachments = await this.context.env.DB.prepare(
      `SELECT id, object_key
       FROM message_attachments WHERE message_id = ?`,
    )
      .bind(draftId)
      .all<{ id: string; object_key: string }>();
    const desired = new Set(input.attachmentIds);
    const keep = new Set(
      existingAttachments.results
        .filter((attachment) => desired.has(attachment.id))
        .map((attachment) => attachment.id),
    );
    const newUploadIds = input.attachmentIds.filter((id) => !keep.has(id));
    const uploads = await this.requireUploads(principal.userId, newUploadIds);
    const removed = existingAttachments.results.filter(
      (attachment) => !keep.has(attachment.id),
    );
    const recipients = normalizeRecipients(input.to, input.cc, input.bcc);
    const recipientRows = [
      ...recipients.to.map((address) => ["to", address]),
      ...recipients.cc.map((address) => ["cc", address]),
      ...recipients.bcc.map((address) => ["bcc", address]),
    ];
    const nextVersion = createDraftVersion();
    // Optimistic-locking batch:
    //   1. The first statement bumps `updated_at` from `draft.updated_at` to
    //      `nextVersion` and is the only authoritative signal of a successful
    //      write — `results[0].meta.changes === 1` is what we treat as
    //      "version is now ours".
    //   2. Every subsequent statement guards on the NEW `nextVersion` via
    //      `EXISTS (SELECT 1 FROM messages WHERE updated_at = ?)` so that
    //      concurrent writers can't be partially mutated. The whole batch is
    //      atomic at the D1 statement boundary, so a conflict on the first
    //      statement short-circuits the rest.
    const results = await this.context.env.DB.batch([
      this.context.env.DB.prepare(
        `UPDATE messages
         SET subject = ?, html_body = ?, text_body = ?,
             updated_at = ?
         WHERE id = ? AND status = 'draft' AND created_by_user_id = ?
           AND updated_at = ?`,
      ).bind(
        input.subject,
        input.html,
        input.text,
        nextVersion,
        draftId,
        principal.userId,
        draft.updated_at,
      ),
      this.context.env.DB.prepare(
        `DELETE FROM message_recipients
         WHERE message_id = ?
           AND EXISTS (
             SELECT 1 FROM messages
             WHERE id = ? AND status = 'draft' AND updated_at = ?
           )`,
      ).bind(draftId, draftId, nextVersion),
      ...this.conditionalRecipientInsertStatements(
        draftId,
        recipientRows,
        nextVersion,
      ),
      ...(removed.length > 0
        ? [
            this.context.env.DB.prepare(
              `DELETE FROM message_attachments
               WHERE message_id = ? AND id IN (${placeholders(removed.length)})
                 AND EXISTS (
                   SELECT 1 FROM messages
                   WHERE id = ? AND status = 'draft' AND updated_at = ?
                 )`,
            ).bind(
              draftId,
              ...removed.map((attachment) => attachment.id),
              draftId,
              nextVersion,
            ),
          ]
        : []),
      ...this.conditionalUploadInsertStatements(draftId, uploads, nextVersion),
    ]);
    if (results[0]?.meta.changes !== 1) {
      throw new DomainError(
        "DRAFT_VERSION_CONFLICT",
        "The draft was modified by another request",
        409,
      );
    }
    for (const attachment of removed) {
      const referenced = await this.context.env.DB.prepare(
        "SELECT 1 FROM message_attachments WHERE object_key = ? LIMIT 1",
      )
        .bind(attachment.object_key)
        .first();
      if (!referenced) {
        await this.context.attachmentStore.delete(attachment.object_key);
      }
    }
    return this.get(principal, draftId);
  }

  async remove(principal: Principal, draftId: string): Promise<void> {
    await this.requireDraft(principal.userId, draftId);
    const attachments = await this.context.env.DB.prepare(
      "SELECT object_key FROM message_attachments WHERE message_id = ?",
    )
      .bind(draftId)
      .all<{ object_key: string }>();
    await this.context.env.DB.prepare(
      "DELETE FROM messages WHERE id = ? AND created_by_user_id = ? AND status = 'draft'",
    )
      .bind(draftId, principal.userId)
      .run();
    for (const attachment of attachments.results) {
      await this.context.attachmentStore.delete(attachment.object_key);
    }
  }

  async send(
    principal: Principal,
    draftId: string,
    ifMatch: string | undefined,
    idempotencyKey: string,
  ): Promise<{ messageId: string; status: "queued" | "sent" }> {
    const replay = await this.context.env.DB.prepare(
      `SELECT request_hash, response_json
       FROM idempotency_records
       WHERE actor_user_id = ? AND operation = 'draft.send'
         AND idempotency_key = ? AND expires_at > CURRENT_TIMESTAMP`,
    )
      .bind(principal.userId, idempotencyKey)
      .first<{ request_hash: string; response_json: string }>();
    const requestHash = await hash(
      JSON.stringify({ draftId, version: ifMatch ?? "" }),
    );
    if (replay) {
      if (replay.request_hash !== requestHash) {
        throw new DomainError(
          "IDEMPOTENCY_KEY_REUSED",
          "The idempotency key was used with different input",
          409,
        );
      }
      return JSON.parse(replay.response_json) as {
        messageId: string;
        status: "queued" | "sent";
      };
    }
    const draft = await this.requireDraft(principal.userId, draftId);
    assertDraftVersion(draft.updated_at, ifMatch);
    await this.mailboxes.assert(principal.userId, draft.mailbox_id, "send");
    const recipients = await this.context.env.DB.prepare(
      `SELECT type, address FROM message_recipients
       WHERE message_id = ? ORDER BY rowid`,
    )
      .bind(draftId)
      .all<{ type: "to" | "cc" | "bcc"; address: string }>();
    if (!recipients.results.some((recipient) => recipient.type === "to")) {
      throw new DomainError(
        "DRAFT_TO_REQUIRED",
        "At least one TO recipient is required",
      );
    }
    const addresses = recipients.results.map((recipient) => recipient.address);
    const internal = await this.context.env.DB.prepare(
      `SELECT id, address FROM mailboxes
       WHERE status = 'active' AND address IN (${placeholders(addresses.length)})`,
    )
      .bind(...addresses)
      .all<{ id: string; address: string }>();
    const internalAddresses = new Set(
      internal.results.map((mailbox) => mailbox.address.toLowerCase()),
    );
    const hasExternal = addresses.some(
      (address) => !internalAddresses.has(address.toLowerCase()),
    );
    if (hasExternal && !draft.outbound_connection_id) {
      throw new DomainError(
        "OUTBOUND_PROVIDER_NOT_CONFIGURED",
        "The sender domain has no outbound provider connection",
        409,
      );
    }
    const jobId = hasExternal ? crypto.randomUUID() : null;
    const status = jobId ? "queued" : "sent";
    const response = { messageId: draftId, status } as const;
    const nextVersion = createDraftVersion();
    // Same optimistic-lock semantics as update(): the first UPDATE is the
    // commit signal, and every later statement (folder move, internal inbox
    // copies, outbound job, idempotency record) is bound to `nextVersion`.
    // The idempotency INSERT is in the same batch so a transaction rollback
    // never leaves a record without the matching state change.
    const results = await this.context.env.DB.batch([
      this.context.env.DB.prepare(
        `UPDATE messages
         SET status = ?, provider_connection_id = ?,
             sent_at = CASE WHEN ? = 'sent' THEN CURRENT_TIMESTAMP ELSE NULL END,
             updated_at = ?
         WHERE id = ? AND status = 'draft' AND created_by_user_id = ?
           AND updated_at = ?`,
      ).bind(
        status,
        hasExternal ? draft.outbound_connection_id : null,
        status,
        nextVersion,
        draftId,
        principal.userId,
        draft.updated_at,
      ),
      this.context.env.DB.prepare(
        `UPDATE mailbox_messages SET folder = 'sent'
         WHERE message_id = ? AND mailbox_id = ? AND folder = 'drafts'
           AND EXISTS (
             SELECT 1 FROM messages
             WHERE id = ? AND status = ? AND updated_at = ?
           )`,
      ).bind(draftId, draft.mailbox_id, draftId, status, nextVersion),
      ...(internal.results.length > 0
        ? internal.results.map((mailbox) =>
            this.context.env.DB.prepare(
              `INSERT OR IGNORE INTO mailbox_messages (
                 id, mailbox_id, message_id, folder
               )
               SELECT ?, ?, ?, 'inbox'
               WHERE EXISTS (
                 SELECT 1 FROM messages
                 WHERE id = ? AND status = ? AND updated_at = ?
               )`,
            ).bind(
              crypto.randomUUID(),
              mailbox.id,
              draftId,
              draftId,
              status,
              nextVersion,
            ),
          )
        : []),
      ...(jobId
        ? [
            this.context.env.DB.prepare(
              `INSERT INTO outbound_jobs (id, message_id, status)
               SELECT ?, ?, 'pending'
               WHERE EXISTS (
                 SELECT 1 FROM messages
                 WHERE id = ? AND status = ? AND updated_at = ?
               )`,
            ).bind(jobId, draftId, draftId, status, nextVersion),
          ]
        : []),
      this.context.env.DB.prepare(
        `INSERT INTO idempotency_records (
           id, actor_user_id, operation, idempotency_key, request_hash,
           resource_id, response_status, response_json, expires_at
         )
         SELECT ?, ?, 'draft.send', ?, ?, ?, 200, ?,
                datetime('now', '+1 day')
         WHERE EXISTS (
           SELECT 1 FROM messages
           WHERE id = ? AND status = ? AND updated_at = ?
         )`,
      ).bind(
        crypto.randomUUID(),
        principal.userId,
        idempotencyKey,
        requestHash,
        draftId,
        JSON.stringify(response),
        draftId,
        status,
        nextVersion,
      ),
    ]);
    if (results[0]?.meta.changes !== 1) {
      throw new DomainError(
        "DRAFT_VERSION_CONFLICT",
        "The draft was modified by another request",
        409,
      );
    }
    if (jobId) {
      try {
        // Best-effort enqueue: if the queue is unavailable the scheduled
        // `recoverExpiredOutboundLocks` + `dispatchPending` cron will pick
        // the row up on the next pass.
        await new OutboundJobService(this.context).dispatch(jobId);
      } catch {
        this.context.logger.warn("outbound.dispatch.deferred", {
          jobId,
          messageId: draftId,
        });
      }
    }
    return response;
  }

  private async requireDraft(
    userId: string,
    draftId: string,
  ): Promise<DraftRow> {
    const draft = await this.context.env.DB.prepare(
      `SELECT m.id, m.created_by_user_id, m.status, m.updated_at,
              mm.mailbox_id, mb.domain_id, mb.address, mb.display_name,
              d.outbound_connection_id
       FROM messages m
       JOIN mailbox_messages mm
         ON mm.message_id = m.id AND mm.folder = 'drafts'
       JOIN mailboxes mb ON mb.id = mm.mailbox_id
       JOIN domains d ON d.id = mb.domain_id
       WHERE m.id = ? AND m.status = 'draft' AND m.created_by_user_id = ?`,
    )
      .bind(draftId, userId)
      .first<DraftRow>();
    if (!draft) {
      throw new DomainError("DRAFT_NOT_FOUND", "Draft not found", 404);
    }
    return draft;
  }

  private async requireUploads(
    userId: string,
    uploadIds: readonly string[],
  ): Promise<UploadRow[]> {
    if (uploadIds.length === 0) return [];
    const result = await this.context.env.DB.prepare(
      `SELECT id, object_key, filename, mime_type, size_bytes, disposition
       FROM attachment_uploads
       WHERE user_id = ? AND status = 'uploaded'
         AND expires_at > CURRENT_TIMESTAMP
         AND id IN (${placeholders(uploadIds.length)})`,
    )
      .bind(userId, ...uploadIds)
      .all<UploadRow>();
    if (result.results.length !== new Set(uploadIds).size) {
      throw new DomainError(
        "ATTACHMENT_UPLOAD_INVALID",
        "One or more attachment uploads are unavailable",
        409,
      );
    }
    return result.results;
  }

  private recipientInsertStatements(
    messageId: string,
    recipients: string[][],
  ): D1PreparedStatement[] {
    if (recipients.length === 0) return [];
    return [
      this.context.env.DB.prepare(
        `INSERT INTO message_recipients (
           id, message_id, type, address, display_name
         ) VALUES ${tuples(recipients.length, 5)}`,
      ).bind(
        ...recipients.flatMap(([type, address]) => [
          crypto.randomUUID(),
          messageId,
          type,
          address,
          "",
        ]),
      ),
    ];
  }

  private conditionalRecipientInsertStatements(
    messageId: string,
    recipients: string[][],
    version: string,
  ): D1PreparedStatement[] {
    return recipients.map(([type, address]) =>
      this.context.env.DB.prepare(
        `INSERT INTO message_recipients (
           id, message_id, type, address, display_name
         )
         SELECT ?, ?, ?, ?, ''
         WHERE EXISTS (
           SELECT 1 FROM messages
           WHERE id = ? AND status = 'draft' AND updated_at = ?
         )`,
      ).bind(crypto.randomUUID(), messageId, type, address, messageId, version),
    );
  }

  private uploadInsertStatements(
    messageId: string,
    uploads: UploadRow[],
  ): D1PreparedStatement[] {
    if (uploads.length === 0) return [];
    return [
      this.context.env.DB.prepare(
        `INSERT INTO message_attachments (
           id, message_id, upload_id, object_key, filename, mime_type,
           size_bytes, disposition
         ) VALUES ${tuples(uploads.length, 8)}`,
      ).bind(
        ...uploads.flatMap((upload) => [
          crypto.randomUUID(),
          messageId,
          upload.id,
          upload.object_key,
          upload.filename,
          upload.mime_type,
          upload.size_bytes,
          upload.disposition,
        ]),
      ),
    ];
  }

  private conditionalUploadInsertStatements(
    messageId: string,
    uploads: UploadRow[],
    version: string,
  ): D1PreparedStatement[] {
    return uploads.map((upload) =>
      this.context.env.DB.prepare(
        `INSERT INTO message_attachments (
           id, message_id, upload_id, object_key, filename, mime_type,
           size_bytes, disposition
         )
         SELECT ?, ?, ?, ?, ?, ?, ?, ?
         WHERE EXISTS (
           SELECT 1 FROM messages
           WHERE id = ? AND status = 'draft' AND updated_at = ?
         )`,
      ).bind(
        crypto.randomUUID(),
        messageId,
        upload.id,
        upload.object_key,
        upload.filename,
        upload.mime_type,
        upload.size_bytes,
        upload.disposition,
        messageId,
        version,
      ),
    );
  }
}
