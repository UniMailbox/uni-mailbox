import { z } from "zod";
import { MAX_ATTACHMENTS_PER_MESSAGE } from "../domain";
import { defineEndpoint } from "./common/endpoint";
import { MailboxFolderSchema } from "./mailboxes";

const UuidSchema = z.string().trim().uuid();
const TimestampSchema = z.string().min(1);
const AddressSchema = z
  .string()
  .trim()
  .email()
  .transform((value) => value.toLowerCase());
const RecipientSchema = z.object({
  type: z.enum(["to", "cc", "bcc"]),
  address: AddressSchema,
  display_name: z.string().nullable().optional(),
});

export const SendMessageSchema = z.object({
  mailboxId: UuidSchema,
  to: z.array(AddressSchema).min(1).max(100),
  cc: z.array(AddressSchema).max(100).default([]),
  bcc: z.array(AddressSchema).max(100).default([]),
  subject: z.string().max(998).default(""),
  html: z.string().max(2_000_000).default(""),
  text: z.string().max(2_000_000).default(""),
  parentMessageId: UuidSchema.optional(),
  includeSignature: z.boolean().default(true),
  attachmentIds: z
    .array(UuidSchema)
    .max(MAX_ATTACHMENTS_PER_MESSAGE)
    .default([]),
});

export type SendMessageInput = z.infer<typeof SendMessageSchema>;

export const MessageSummarySchema = z.object({
  id: UuidSchema,
  mailbox_id: UuidSchema.optional(),
  from_address: z.string().email(),
  from_name: z.string().nullable().optional(),
  subject: z.string(),
  status: z.string().optional(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema.optional(),
  received_at: TimestampSchema.nullable().optional(),
  sent_at: TimestampSchema.nullable().optional(),
  is_read: z.number().int().min(0).max(1).optional(),
  is_starred: z.number().int().min(0).max(1).optional(),
});

export const MessageDetailSchema = z.object({
  id: UuidSchema,
  thread_id: UuidSchema.nullable(),
  mailboxMessageId: UuidSchema,
  mailboxId: UuidSchema,
  from_address: z.string().email(),
  from_name: z.string().nullable(),
  subject: z.string(),
  html_body: z.string(),
  text_body: z.string(),
  message_id_header: z.string().nullable(),
  in_reply_to_header: z.string().nullable(),
  references_header: z.string(),
  status: z.string(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
  sent_at: TimestampSchema.nullable(),
  received_at: TimestampSchema.nullable(),
  recipients: z.array(RecipientSchema),
});

export const MessageAttachmentSchema = z.object({
  id: UuidSchema,
  filename: z.string().nullable(),
  mime_type: z.string(),
  size_bytes: z.number().int().nonnegative(),
  disposition: z.enum(["attachment", "inline"]),
  content_id: z.string().nullable(),
});

const messageErrors = [
  "AUTH_REQUIRED",
  "MAILBOX_NOT_FOUND",
  "MAILBOX_PERMISSION_DENIED",
  "MESSAGE_NOT_FOUND",
  "PERMISSION_DENIED",
  "VALIDATION_FAILED",
  "CURSOR_INVALID",
  "IDEMPOTENCY_KEY_REQUIRED",
  "IDEMPOTENCY_KEY_REUSED",
  "ATTACHMENT_UPLOAD_INVALID",
  "MESSAGE_SEND_RATE_LIMITED",
  "SENDER_MAILBOX_INACTIVE",
  "OUTBOUND_PROVIDER_NOT_CONFIGURED",
  "PROVIDER_CONNECTION_INACTIVE",
] as const;

const messageSendErrors = [
  ...messageErrors,
  "PARENT_MESSAGE_NOT_FOUND",
] as const;

export const messageEndpoints = {
  list: defineEndpoint({
    method: "GET",
    path: "/mailboxes/:mailboxId/messages",
    request: {
      params: z.object({ mailboxId: UuidSchema }),
      query: z.object({
        cursor: z.string().min(1).optional(),
        limit: z.number().int().min(1).max(100).optional(),
        folder: MailboxFolderSchema.exclude(["starred"]),
        starred: z.boolean().optional(),
      }),
    },
    responses: {
      200: z.object({
        items: z.array(MessageSummarySchema),
        nextCursor: z.string().nullable(),
      }),
    },
    errors: messageErrors,
    mediaType: "json",
  }),
  get: defineEndpoint({
    method: "GET",
    path: "/messages/:messageId",
    request: { params: z.object({ messageId: UuidSchema }) },
    responses: { 200: MessageDetailSchema },
    errors: messageErrors,
    mediaType: "json",
  }),
  star: defineEndpoint({
    method: "PATCH",
    path: "/messages/:messageId/star",
    request: {
      params: z.object({ messageId: UuidSchema }),
      body: z.object({ isStarred: z.boolean() }),
    },
    responses: { 200: z.object({ updated: z.literal(true) }) },
    errors: messageErrors,
    mediaType: "json",
  }),
  move: defineEndpoint({
    method: "PATCH",
    path: "/messages/:messageId/folder",
    request: {
      params: z.object({ messageId: UuidSchema }),
      body: z.object({
        mailboxId: UuidSchema,
        folder: z.enum(["inbox", "archive", "trash"]),
      }),
    },
    responses: {
      200: z.object({
        updated: z.literal(true),
        folder: z.enum(["inbox", "archive", "trash"]),
      }),
    },
    errors: messageErrors,
    mediaType: "json",
  }),
  send: defineEndpoint({
    method: "POST",
    path: "/messages/send",
    request: {
      headers: z.object({
        "idempotency-key": z.string().trim().min(1).max(255),
      }),
      body: SendMessageSchema,
    },
    responses: {
      201: z.object({
        messageId: UuidSchema,
        status: z.enum(["queued", "sent"]),
      }),
    },
    errors: messageSendErrors,
    mediaType: "json",
  }),
  listAttachments: defineEndpoint({
    method: "GET",
    path: "/messages/:messageId/attachments",
    request: { params: z.object({ messageId: UuidSchema }) },
    responses: { 200: z.array(MessageAttachmentSchema) },
    errors: messageErrors,
    mediaType: "json",
  }),
} as const;
