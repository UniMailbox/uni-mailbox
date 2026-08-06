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

// A scheduled send is only unambiguous when the client states the instant it
// means, so the contract requires an explicit UTC offset (or `Z`). A local
// wall-clock string such as `2026-08-06T09:00:00` would otherwise be resolved
// against the Worker's clock rather than the user's, silently shifting the
// send by hours. The window itself (minimum lead time / maximum horizon) is
// checked server-side against the request-time clock, not here.
const ISO_PARTS_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/;
const IsoInstantWithOffsetSchema = z
  .string()
  .trim()
  .regex(ISO_PARTS_RE, {
    message:
      "scheduledAt must be an ISO 8601 instant with an explicit UTC offset",
  })
  .refine(
    (value) => {
      // `new Date('2026-02-30T...Z')` overflows silently, so we recompute the
      // wall-clock fields from the UTC epoch and compare. Also catches things
      // the regex admits but the calendar doesn't, like 2026-02-30 or
      // 2026-13-01. Components are parsed numerically to avoid surprises
      // around leading zeros.
      const match = value.match(ISO_PARTS_RE);
      if (!match) return false;
      const [, y, mo, d, h, mi, s, ms, offset] = match;
      const year = Number(y);
      const month = Number(mo);
      const day = Number(d);
      const hour = Number(h);
      const minute = Number(mi);
      const second = Number(s ?? "0");
      const millis = ms ? Number(ms.padEnd(3, "0")) : 0;
      const offsetMinutes = parseIsoOffsetMinutes(offset);
      if (offsetMinutes === null) return false;
      const epoch = Date.UTC(
        year,
        month - 1,
        day,
        hour,
        minute,
        second,
        millis,
      );
      if (Number.isNaN(epoch)) return false;
      const utc = epoch - offsetMinutes * 60 * 1_000;
      return (
        new Date(utc).getUTCFullYear() === year &&
        new Date(utc).getUTCMonth() + 1 === month &&
        new Date(utc).getUTCDate() === day
      );
    },
    { message: "scheduledAt must be a real calendar instant" },
  );

function parseIsoOffsetMinutes(offset: string): number | null {
  if (offset === "Z") return 0;
  const sign = offset.startsWith("-") ? -1 : 1;
  const hours = Number(offset.slice(1, 3));
  const minutes = Number(offset.slice(4, 6));
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return sign * (hours * 60 + minutes);
}

export const DraftScheduleSchema = z.object({
  scheduledAt: IsoInstantWithOffsetSchema,
});
export type DraftScheduleInput = z.infer<typeof DraftScheduleSchema>;

const DraftDetailSchema = z.object({
  id: UuidSchema,
  mailboxId: UuidSchema,
  subject: z.string(),
  html_body: z.string(),
  text_body: z.string(),
  updated_at: z.string().min(1),
  // Derived from the pending outbound job, not a stored message column: absent
  // or null means the draft is not scheduled. Optional so responses written
  // before scheduled send existed still parse.
  scheduled_at: z.string().nullable().optional(),
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
  scheduled_at: z.string().nullable().optional(),
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

const draftReadErrors = [
  ...draftErrors,
  "DRAFT_NOT_FOUND",
  "DRAFT_SCHEDULED",
] as const;

const draftScheduleErrors = [
  ...draftReadErrors,
  "SCHEDULE_WINDOW_EXCEEDED",
  "SCHEDULE_ALREADY_DISPATCHED",
] as const;

const IdempotencyKeySchema = z.string().trim().min(1).max(255);

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
    errors: draftReadErrors,
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
    errors: draftReadErrors,
    mediaType: "json",
  }),
  send: defineEndpoint({
    method: "POST",
    path: "/drafts/:draftId/send",
    request: {
      params: z.object({ draftId: UuidSchema }),
      headers: z.object({
        "if-match": EtagSchema,
        "idempotency-key": IdempotencyKeySchema,
      }),
    },
    responses: {
      200: z.object({
        messageId: UuidSchema,
        status: z.enum(["queued", "sent"]),
      }),
    },
    errors: draftReadErrors,
    mediaType: "json",
  }),
  // Scheduling reuses the draft optimistic-lock (`If-Match`) and idempotency
  // envelope of `send`. The schedule endpoint never degrades to an immediate
  // send: instants inside the 90-second minimum lead time or in the past
  // fail with `SCHEDULE_WINDOW_EXCEEDED`, so the response shape only needs
  // to model the deferred-send outcome.
  schedule: defineEndpoint({
    method: "POST",
    path: "/drafts/:draftId/schedule",
    request: {
      params: z.object({ draftId: UuidSchema }),
      headers: z.object({
        "if-match": EtagSchema,
        "idempotency-key": IdempotencyKeySchema,
      }),
      body: DraftScheduleSchema,
    },
    responses: {
      200: z.object({
        messageId: UuidSchema,
        status: z.literal("scheduled"),
        scheduledAt: z.string().min(1),
        updatedAt: z.string().min(1),
      }),
    },
    errors: draftScheduleErrors,
    mediaType: "json",
  }),
  cancelSchedule: defineEndpoint({
    method: "DELETE",
    path: "/drafts/:draftId/schedule",
    request: {
      params: z.object({ draftId: UuidSchema }),
      headers: z.object({
        "if-match": EtagSchema,
        "idempotency-key": IdempotencyKeySchema,
      }),
    },
    // `cancelled: false` is the idempotent no-op answer for a draft that has
    // no pending schedule, so a retried cancel never fails.
    responses: {
      200: z.object({
        messageId: UuidSchema,
        status: z.literal("draft"),
        cancelled: z.boolean(),
        updatedAt: z.string().min(1),
      }),
    },
    errors: draftScheduleErrors,
    mediaType: "json",
  }),
} as const;
