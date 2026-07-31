import { z } from "zod";
import { MAX_ATTACHMENT_BYTES } from "../domain";
import { defineEndpoint } from "./common/endpoint";

const UuidSchema = z.string().trim().uuid();

export const CreateAttachmentUploadSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(255),
  size: z.number().int().positive().max(MAX_ATTACHMENT_BYTES),
  disposition: z.enum(["attachment", "inline"]).default("attachment"),
});
export type CreateAttachmentUploadInput = z.infer<
  typeof CreateAttachmentUploadSchema
>;

export const AttachmentDownloadSchema = z.object({
  blob: z.instanceof(Blob),
  contentDisposition: z.string().nullable(),
});

const attachmentErrors = [
  "AUTH_REQUIRED",
  "ATTACHMENT_NOT_FOUND",
  "ATTACHMENT_UPLOAD_NOT_FOUND",
  "ATTACHMENT_UPLOAD_UNAVAILABLE",
  "ATTACHMENT_ALREADY_CONSUMED",
  "ATTACHMENT_OBJECT_MISSING",
  "ATTACHMENT_TOO_LARGE",
  "ATTACHMENT_RATE_LIMITED",
  "ATTACHMENT_OBJECT_MISMATCH",
  "ATTACHMENT_UPLOAD_EXPIRED",
] as const;

export const attachmentEndpoints = {
  createUpload: defineEndpoint({
    method: "POST",
    path: "/attachments/uploads",
    request: { body: CreateAttachmentUploadSchema },
    responses: {
      201: z.object({
        attachmentId: UuidSchema,
        objectKey: z.string().min(1),
        uploadUrl: z.string().url(),
        uploadHeaders: z.record(z.string()),
        expiresAt: z.string().datetime(),
        transport: z.enum(["worker-r2-binding", "worker-kv-binding"]),
      }),
    },
    errors: attachmentErrors,
    mediaType: "json",
  }),
  completeUpload: defineEndpoint({
    method: "POST",
    path: "/attachments/uploads/:attachmentId/complete",
    request: { params: z.object({ attachmentId: UuidSchema }) },
    responses: {
      200: z.object({
        attachmentId: UuidSchema,
        status: z.literal("uploaded"),
      }),
    },
    errors: attachmentErrors,
    mediaType: "json",
  }),
  download: defineEndpoint({
    method: "GET",
    path: "/attachments/:attachmentId/download",
    request: { params: z.object({ attachmentId: UuidSchema }) },
    responses: { 200: AttachmentDownloadSchema },
    errors: attachmentErrors,
    mediaType: "binary",
    binaryResponse: "blob-with-content-disposition",
  }),
} as const;
