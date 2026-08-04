import {
  DomainError,
  PRESIGN_TTL_SECONDS,
  type CreateAttachmentUploadInput,
  type Principal,
} from "@unimailbox/contracts";
import type { Env } from "../../platform/config";
import {
  KV_VALUE_LIMIT,
  type AttachmentStore,
} from "../../platform/attachment-store";
import { enforceRateLimit, rateLimitRules } from "../../platform/rate-limit";
import type { UploadTokenCodec } from "./upload-token";
import { createAttachmentDownloadResponse } from "./download-response";
import {
  deleteAttachmentFileIfUnreferenced,
  storeAttachmentFile,
} from "./file-catalog";

interface UploadRow {
  id: string;
  user_id: string;
  object_key: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  disposition: "attachment" | "inline";
  status: "pending" | "uploaded" | "consumed" | "expired";
  expires_at: string;
  file_id: string | null;
  md5: string | null;
  stored_object_key: string;
}

interface SettingsRow {
  max_attachment_bytes: number;
}

function safeExtension(filename: string): string {
  const match = filename.toLowerCase().match(/\.([a-z0-9]{1,10})$/u);
  return match ? `.${match[1]}` : "";
}

function dispositionHeader(
  disposition: "attachment" | "inline",
  filename: string,
): string {
  return `${disposition}; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export class AttachmentApplicationService {
  constructor(
    private readonly env: Env,
    private readonly tokens: UploadTokenCodec,
    private readonly store: AttachmentStore,
  ) {}

  async create(
    principal: Principal,
    input: CreateAttachmentUploadInput,
    requestUrl: string,
  ) {
    await enforceRateLimit(
      this.env.KV,
      rateLimitRules.attachmentUpload,
      principal.userId,
    );
    const settings = await this.env.DB.prepare(
      "SELECT max_attachment_bytes FROM system_settings WHERE id = 1",
    ).first<SettingsRow>();
    const backendLimit = KV_VALUE_LIMIT - 1;
    const allowedBytes =
      this.store.backend === "r2"
        ? (settings?.max_attachment_bytes ?? backendLimit)
        : Math.min(
            settings?.max_attachment_bytes ?? backendLimit,
            backendLimit,
          );
    if (input.size > allowedBytes) {
      throw new DomainError(
        "ATTACHMENT_TOO_LARGE",
        `Attachments larger than ${allowedBytes} bytes are not supported on the ${this.store.backend} backend`,
        413,
        { limit: allowedBytes, backend: this.store.backend },
      );
    }
    const attachmentId = crypto.randomUUID();
    const objectKey = `attachments/${attachmentId}${safeExtension(input.filename)}`;
    const expiresAt = new Date(Date.now() + PRESIGN_TTL_SECONDS * 1000);
    await this.env.DB.prepare(
      `INSERT INTO attachment_uploads (
         id, user_id, object_key, filename, mime_type, size_bytes,
         disposition, status, expires_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    )
      .bind(
        attachmentId,
        principal.userId,
        objectKey,
        input.filename,
        input.contentType,
        input.size,
        input.disposition,
        expiresAt
          .toISOString()
          .replace("T", " ")
          .replace(/\.\d{3}Z$/u, ""),
      )
      .run();
    const claims = {
      uploadId: attachmentId,
      objectKey,
      contentType: input.contentType,
      filename: input.filename,
      disposition: input.disposition,
      size: input.size,
      expiresAt: expiresAt.getTime(),
    } as const;
    const uploadUrl = new URL(
      `/api/v1/attachments/uploads/${attachmentId}/content`,
      requestUrl,
    );
    uploadUrl.searchParams.set("token", await this.tokens.encode(claims));
    return {
      attachmentId,
      objectKey,
      uploadUrl: uploadUrl.toString(),
      uploadHeaders: {
        "Content-Length": String(input.size),
        "Content-Type": input.contentType,
        "Content-Disposition": dispositionHeader(
          input.disposition,
          input.filename,
        ),
        "x-amz-meta-filename": input.filename,
      },
      expiresAt: expiresAt.toISOString(),
      transport:
        this.store.backend === "r2" ? "worker-r2-binding" : "worker-kv-binding",
    };
  }

  async uploadContent(
    uploadId: string,
    token: string,
    request: Request,
  ): Promise<void> {
    const claims = await this.tokens.decode(token);
    if (claims.uploadId !== uploadId) {
      throw new DomainError(
        "ATTACHMENT_UPLOAD_TOKEN_INVALID",
        "The attachment upload token does not match this upload",
        401,
      );
    }
    const expectedDisposition = dispositionHeader(
      claims.disposition,
      claims.filename,
    );
    if (
      request.headers.get("content-type") !== claims.contentType ||
      request.headers.get("content-disposition") !== expectedDisposition ||
      request.headers.get("x-amz-meta-filename") !== claims.filename ||
      Number(request.headers.get("content-length")) !== claims.size
    ) {
      throw new DomainError(
        "ATTACHMENT_UPLOAD_HEADERS_INVALID",
        "The signed attachment headers do not match",
        400,
      );
    }
    if (!request.body) {
      throw new DomainError(
        "ATTACHMENT_UPLOAD_EMPTY",
        "The attachment body is required",
      );
    }
    const row = await this.env.DB.prepare(
      `SELECT au.id, au.user_id, au.object_key, au.filename, au.mime_type,
              au.size_bytes, au.disposition, au.status, au.expires_at,
              au.file_id, au.md5,
              COALESCE(af.object_key, au.object_key) AS stored_object_key
       FROM attachment_uploads au
       LEFT JOIN attachment_files af ON af.id = au.file_id
       WHERE au.id = ?`,
    )
      .bind(uploadId)
      .first<UploadRow>();
    if (
      !row ||
      row.status !== "pending" ||
      row.object_key !== claims.objectKey ||
      row.file_id !== null
    ) {
      throw new DomainError(
        "ATTACHMENT_UPLOAD_UNAVAILABLE",
        "The attachment upload is unavailable",
        409,
      );
    }
    const file = await storeAttachmentFile(
      { env: this.env, attachmentStore: this.store },
      {
        objectKey: row.object_key,
        body: request.body,
        sizeBytes: row.size_bytes,
        metadata: {
          httpMetadata: {
            contentType: row.mime_type,
            contentDisposition: expectedDisposition,
          },
          customMetadata: {
            uploadId: row.id,
            filename: row.filename,
            disposition: row.disposition,
            expectedSize: String(row.size_bytes),
          },
        },
      },
    );
    const updated = await this.env.DB.prepare(
      `UPDATE attachment_uploads
       SET file_id = ?, md5 = ?
       WHERE id = ? AND status = 'pending' AND file_id IS NULL`,
    )
      .bind(file.fileId, file.md5, row.id)
      .run();
    if (updated.meta.changes !== 1) {
      await deleteAttachmentFileIfUnreferenced(
        { env: this.env, attachmentStore: this.store },
        file.fileId,
      );
      throw new DomainError(
        "ATTACHMENT_UPLOAD_UNAVAILABLE",
        "The attachment upload is unavailable",
        409,
      );
    }
  }

  async complete(principal: Principal, uploadId: string) {
    const row = await this.requireOwned(principal.userId, uploadId);
    if (row.status === "consumed") {
      throw new DomainError(
        "ATTACHMENT_ALREADY_CONSUMED",
        "The attachment upload has already been consumed",
        409,
      );
    }
    if (row.status === "uploaded") {
      return { attachmentId: row.id, status: row.status };
    }
    if (row.status !== "pending") {
      throw new DomainError(
        "ATTACHMENT_UPLOAD_UNAVAILABLE",
        "The attachment upload is unavailable",
        409,
      );
    }
    const object = await this.store.head(row.stored_object_key);
    if (!object || object.size !== row.size_bytes || !row.file_id || !row.md5) {
      throw new DomainError(
        "ATTACHMENT_OBJECT_MISMATCH",
        "The uploaded object does not match its signed metadata",
        409,
      );
    }
    const updated = await this.env.DB.prepare(
      `UPDATE attachment_uploads
       SET status = 'uploaded'
       WHERE id = ? AND user_id = ? AND status = 'pending'
         AND expires_at > CURRENT_TIMESTAMP`,
    )
      .bind(uploadId, principal.userId)
      .run();
    if (updated.meta.changes !== 1) {
      throw new DomainError(
        "ATTACHMENT_UPLOAD_EXPIRED",
        "The attachment upload has expired",
        409,
      );
    }
    return { attachmentId: row.id, status: "uploaded" };
  }

  async cancel(principal: Principal, uploadId: string): Promise<void> {
    const row = await this.requireOwned(principal.userId, uploadId);
    if (row.status === "consumed") {
      throw new DomainError(
        "ATTACHMENT_ALREADY_CONSUMED",
        "The attachment upload has already been consumed",
        409,
      );
    }
    const deleted = await this.env.DB.prepare(
      `DELETE FROM attachment_uploads
       WHERE id = ? AND user_id = ? AND status != 'consumed'`,
    )
      .bind(uploadId, principal.userId)
      .run();
    if (deleted.meta.changes === 1) {
      if (row.file_id) {
        await deleteAttachmentFileIfUnreferenced(
          { env: this.env, attachmentStore: this.store },
          row.file_id,
        );
      } else {
        await this.store.delete(row.object_key);
      }
    }
  }

  async download(
    principal: Principal,
    attachmentId: string,
  ): Promise<Response> {
    const attachment = await this.env.DB.prepare(
      `SELECT ma.object_key, ma.filename, ma.mime_type, ma.disposition
       FROM message_attachments ma
       JOIN mailbox_messages mm ON mm.message_id = ma.message_id
       JOIN mailboxes mb ON mb.id = mm.mailbox_id
       LEFT JOIN mailbox_members member
         ON member.mailbox_id = mb.id AND member.user_id = ?
       WHERE ma.id = ? AND (mb.owner_user_id = ? OR member.user_id = ?)
       LIMIT 1`,
    )
      .bind(principal.userId, attachmentId, principal.userId, principal.userId)
      .first<{
        object_key: string;
        filename: string | null;
        mime_type: string;
        disposition: "attachment" | "inline";
      }>();
    if (!attachment) {
      throw new DomainError(
        "ATTACHMENT_NOT_FOUND",
        "Attachment not found",
        404,
      );
    }
    const object = await this.store.get(attachment.object_key);
    if (!object) {
      throw new DomainError(
        "ATTACHMENT_OBJECT_MISSING",
        "The attachment object is unavailable",
        503,
      );
    }
    return createAttachmentDownloadResponse(object, {
      filename: attachment.filename,
      mimeType: attachment.mime_type,
      disposition: attachment.disposition,
    });
  }

  private async requireOwned(
    userId: string,
    uploadId: string,
  ): Promise<UploadRow> {
    const row = await this.env.DB.prepare(
      `SELECT au.id, au.user_id, au.object_key, au.filename, au.mime_type,
              au.size_bytes, au.disposition, au.status, au.expires_at,
              au.file_id, au.md5,
              COALESCE(af.object_key, au.object_key) AS stored_object_key
       FROM attachment_uploads au
       LEFT JOIN attachment_files af ON af.id = au.file_id
       WHERE au.id = ? AND au.user_id = ?`,
    )
      .bind(uploadId, userId)
      .first<UploadRow>();
    if (!row) {
      throw new DomainError(
        "ATTACHMENT_UPLOAD_NOT_FOUND",
        "Attachment upload not found",
        404,
      );
    }
    return row;
  }
}
