import { z } from "zod";
import { MAX_ATTACHMENTS_PER_MESSAGE, MAX_ATTACHMENT_BYTES } from "../domain";

export interface ApiSuccess<T> {
  data: T;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId: string;
  };
}

export type ApiResult<T> = ApiSuccess<T> | ApiErrorBody;

const AddressSchema = z
  .string()
  .trim()
  .email()
  .transform((value) => value.toLowerCase());

export const SendMessageSchema = z.object({
  mailboxId: z.string().uuid(),
  to: z.array(AddressSchema).min(1).max(100),
  cc: z.array(AddressSchema).max(100).default([]),
  bcc: z.array(AddressSchema).max(100).default([]),
  subject: z.string().max(998).default(""),
  html: z.string().max(2_000_000).default(""),
  text: z.string().max(2_000_000).default(""),
  parentMessageId: z.string().uuid().optional(),
  includeSignature: z.boolean().default(true),
  attachmentIds: z
    .array(z.string().uuid())
    .max(MAX_ATTACHMENTS_PER_MESSAGE)
    .default([]),
});

export type SendMessageInput = z.infer<typeof SendMessageSchema>;

export const DraftMessageSchema = SendMessageSchema.extend({
  to: z.array(AddressSchema).max(100).default([]),
});

export type DraftMessageInput = z.infer<typeof DraftMessageSchema>;

export const CreateAttachmentUploadSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(255),
  size: z.number().int().positive().max(MAX_ATTACHMENT_BYTES),
  disposition: z.enum(["attachment", "inline"]).default("attachment"),
});

export type CreateAttachmentUploadInput = z.infer<
  typeof CreateAttachmentUploadSchema
>;

export interface AttachmentUpload {
  attachmentId: string;
  objectKey: string;
  uploadUrl: string;
  uploadHeaders: Record<string, string>;
  expiresAt: string;
}

export const LoginSchema = z.object({
  email: z
    .string()
    .trim()
    .email()
    .transform((value) => value.toLowerCase()),
  password: z.string().min(12).max(1024),
});

export const RegisterSchema = LoginSchema.extend({
  displayName: z.string().trim().min(1).max(120),
  registrationKey: z.string().trim().min(8).max(255).optional(),
});

export const MailboxCreateSchema = z.object({
  localPart: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i),
  domainId: z.string().uuid(),
  displayName: z.string().trim().max(120).default(""),
});

export const MailboxMemberSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(["viewer", "sender", "admin"]),
});

export const ProviderConnectionSchema = z.object({
  providerKey: z.string().min(2).max(32),
  label: z.string().trim().min(1).max(80),
  apiKey: z.string().min(8),
  webhookSecret: z.string().min(8),
});

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}
