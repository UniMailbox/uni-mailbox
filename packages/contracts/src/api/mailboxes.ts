import { z } from "zod";
import { defineEndpoint } from "./common/endpoint";

const UuidSchema = z.string().trim().uuid();
const TimestampSchema = z.string().min(1);

export const MailboxFolderSchema = z.enum([
  "inbox",
  "sent",
  "drafts",
  "starred",
  "archive",
  "trash",
]);

export const MailboxSchema = z.object({
  id: UuidSchema,
  address: z.string().email(),
  display_name: z.string(),
  status: z.string(),
  domain_id: UuidSchema,
  role: z.enum(["owner", "viewer", "sender", "admin"]),
  unread_count: z.number().int().nonnegative().optional(),
});

export const MailboxDetailSchema = z.object({
  id: UuidSchema,
  domain_id: UuidSchema,
  owner_user_id: UuidSchema,
  address: z.string().email(),
  display_name: z.string(),
  status: z.string(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});

export const MailboxCreateSchema = z.object({
  localPart: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i),
  domainId: UuidSchema,
  displayName: z.string().trim().max(120).default(""),
});

export const MailboxMemberSchema = z.object({
  userId: UuidSchema,
  role: z.enum(["viewer", "sender", "admin"]),
});

const MailboxMemberResponseSchema = z.object({
  mailboxId: UuidSchema,
  userId: UuidSchema,
  role: z.enum(["viewer", "sender", "admin"]),
});

const MailboxMemberListItemSchema = z.object({
  user_id: UuidSchema,
  email: z.string().email(),
  display_name: z.string(),
  role: z.enum(["viewer", "sender", "admin"]),
  created_at: TimestampSchema,
});

const mailboxErrors = [
  "AUTH_REQUIRED",
  "MAILBOX_NOT_FOUND",
  "MAILBOX_PERMISSION_DENIED",
  "PERMISSION_DENIED",
  "VALIDATION_FAILED",
  "MAILBOX_ADDRESS_CONFLICT",
  "DOMAIN_NOT_ACTIVE",
  "MAILBOX_LOCAL_PART_RESERVED",
  "MAILBOX_QUOTA_EXCEEDED",
  "MAILBOX_OWNER_MEMBERSHIP_INVALID",
] as const;

export const mailboxEndpoints = {
  list: defineEndpoint({
    method: "GET",
    path: "/mailboxes",
    responses: { 200: z.array(MailboxSchema) },
    errors: mailboxErrors,
    mediaType: "json",
  }),
  create: defineEndpoint({
    method: "POST",
    path: "/mailboxes",
    request: { body: MailboxCreateSchema },
    responses: {
      201: z.object({
        id: UuidSchema,
        domainId: UuidSchema,
        address: z.string().email(),
        displayName: z.string(),
      }),
    },
    errors: mailboxErrors,
    mediaType: "json",
  }),
  get: defineEndpoint({
    method: "GET",
    path: "/mailboxes/:mailboxId",
    request: { params: z.object({ mailboxId: UuidSchema }) },
    responses: { 200: MailboxDetailSchema },
    errors: mailboxErrors,
    mediaType: "json",
  }),
  listMembers: defineEndpoint({
    method: "GET",
    path: "/mailboxes/:mailboxId/members",
    request: { params: z.object({ mailboxId: UuidSchema }) },
    responses: { 200: z.array(MailboxMemberListItemSchema) },
    errors: mailboxErrors,
    mediaType: "json",
  }),
  addMember: defineEndpoint({
    method: "POST",
    path: "/mailboxes/:mailboxId/members",
    request: {
      params: z.object({ mailboxId: UuidSchema }),
      body: MailboxMemberSchema,
    },
    responses: { 201: MailboxMemberResponseSchema },
    errors: mailboxErrors,
    mediaType: "json",
  }),
  updateMember: defineEndpoint({
    method: "PATCH",
    path: "/mailboxes/:mailboxId/members/:userId",
    request: {
      params: z.object({ mailboxId: UuidSchema, userId: UuidSchema }),
      body: MailboxMemberSchema.pick({ role: true }),
    },
    responses: { 200: MailboxMemberResponseSchema },
    errors: mailboxErrors,
    mediaType: "json",
  }),
  removeMember: defineEndpoint({
    method: "DELETE",
    path: "/mailboxes/:mailboxId/members/:userId",
    request: {
      params: z.object({ mailboxId: UuidSchema, userId: UuidSchema }),
    },
    responses: { 204: null },
    errors: mailboxErrors,
    mediaType: "empty",
  }),
} as const;
