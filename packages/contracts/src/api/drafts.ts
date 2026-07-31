import { z } from "zod";
import { defineEndpoint } from "./common/endpoint";
import { MessageAttachmentSchema, SendMessageSchema } from "./messages";

const UuidSchema = z.string().trim().uuid();
const AddressSchema = z
  .string()
  .trim()
  .email()
  .transform((value) => value.toLowerCase());
const EtagSchema = z.string().trim().min(1).max(1024);
const RecipientSchema = z.object({
  type: z.enum(["to", "cc", "bcc"]),
  address: AddressSchema,
  display_name: z.string().nullable().optional(),
});

export const DraftMessageSchema = SendMessageSchema.extend({
  to: z.array(AddressSchema).max(100).default([]),
});
export type DraftMessageInput = z.infer<typeof DraftMessageSchema>;

const DraftDetailSchema = z.object({
  id: UuidSchema,
  mailboxId: UuidSchema,
  subject: z.string(),
  html_body: z.string(),
  text_body: z.string(),
  updated_at: z.string().min(1),
  recipients: z.array(RecipientSchema),
  attachments: z.array(MessageAttachmentSchema),
});

const DraftSummarySchema = z.object({
  id: UuidSchema,
  mailbox_id: UuidSchema,
  subject: z.string(),
  updated_at: z.string().min(1),
  created_at: z.string().min(1),
  from_address: z.string().email(),
  from_name: z.string().nullable().optional(),
  status: z.string().optional(),
  received_at: z.string().nullable().optional(),
  sent_at: z.string().nullable().optional(),
  is_read: z.number().int().min(0).max(1).optional(),
  is_starred: z.number().int().min(0).max(1).optional(),
});

const draftErrors = [
  "AUTH_REQUIRED",
  "MAILBOX_NOT_FOUND",
  "MAILBOX_PERMISSION_DENIED",
  "MESSAGE_NOT_FOUND",
  "VALIDATION_FAILED",
  "IDEMPOTENCY_KEY_REUSED",
  "DRAFT_VERSION_REQUIRED",
  "DRAFT_VERSION_CONFLICT",
  "DRAFT_MAILBOX_IMMUTABLE",
  "DRAFT_TO_REQUIRED",
  "ATTACHMENT_UPLOAD_INVALID",
  "SENDER_MAILBOX_INACTIVE",
  "OUTBOUND_PROVIDER_NOT_CONFIGURED",
  "PROVIDER_CONNECTION_INACTIVE",
] as const;

export const draftEndpoints = {
  list: defineEndpoint({
    method: "GET",
    path: "/drafts",
    responses: { 200: z.array(DraftSummarySchema) },
    errors: draftErrors,
    mediaType: "json",
  }),
  get: defineEndpoint({
    method: "GET",
    path: "/drafts/:draftId",
    request: { params: z.object({ draftId: UuidSchema }) },
    responses: { 200: DraftDetailSchema },
    errors: draftErrors,
    mediaType: "json",
  }),
  create: defineEndpoint({
    method: "POST",
    path: "/drafts",
    request: { body: DraftMessageSchema },
    responses: { 201: DraftDetailSchema },
    errors: draftErrors,
    mediaType: "json",
  }),
  update: defineEndpoint({
    method: "PUT",
    path: "/drafts/:draftId",
    request: {
      params: z.object({ draftId: UuidSchema }),
      headers: z.object({ "if-match": EtagSchema }),
      body: DraftMessageSchema,
    },
    responses: { 200: DraftDetailSchema },
    errors: draftErrors,
    mediaType: "json",
  }),
  send: defineEndpoint({
    method: "POST",
    path: "/drafts/:draftId/send",
    request: {
      params: z.object({ draftId: UuidSchema }),
      headers: z.object({
        "if-match": EtagSchema,
        "idempotency-key": z.string().trim().min(1).max(255),
      }),
    },
    responses: {
      200: z.object({
        messageId: UuidSchema,
        status: z.enum(["queued", "sent"]),
      }),
    },
    errors: draftErrors,
    mediaType: "json",
  }),
} as const;
