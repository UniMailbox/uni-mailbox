/**
 * Shared primitives for the draft scheduled-send flow.
 *
 * The HTTP shape lives in `packages/contracts/src/api/drafts.ts`; this module
 * holds the *behavioural* pieces the worker service composes so they can be
 * unit-tested without a D1 binding and reused by the cron dispatcher added
 * later (task #7).
 *
 * Design notes:
 *
 *  - `available_at` is the schedule's source of truth in D1: a pending
 *    `outbound_jobs` row whose `available_at` is still in the future means
 *    the draft is scheduled. Cancelling removes that row; rescheduling
 *    updates it. The message `status` and `mailbox_messages.folder` are not
 *    touched, so the existing draft read paths keep working.
 *
 *  - All times are normalised to UTC before persistence. D1 stores
 *    `strftime('%Y-%m-%d %H:%M:%f', 'now')`-shaped strings, so the helper
 *    `toD1Timestamp` and its inverse `toIsoFromD1` give the rest of the
 *    codebase a single, easy-to-grep contract for converting in and out of
 *    the database. The leading-`Z`/offset suffix is stripped on the way in
 *    and re-attached on the way out, so `lexicographic compare == temporal
 *    compare` for the `available_at` index in `migrations/0001_initial.sql`.
 *
 *  - Window validation is *only* about the instant relative to `now`. The
 *    contract layer (zod) has already enforced the ISO+offset shape; the
 *    worker is the only place that needs an injected clock so tests can pin
 *    `now` without monkey-patching `Date`. Anything outside
 *    `[now + 90s, now + 30d]` is a hard failure (`SCHEDULE_WINDOW_EXCEEDED`)
 *    — the endpoint never degrades to an immediate send.
 */
import { DomainError } from "@unimailbox/contracts";

/** Minimum lead time before a schedule is accepted. */
export const SCHEDULE_MIN_LEAD_SECONDS = 90;
/** Maximum horizon a schedule can be set against. */
export const SCHEDULE_MAX_LEAD_SECONDS = 30 * 24 * 60 * 60;

/** Idempotency `operation` strings used by the schedule/cancel flow. */
export const SCHEDULE_OPERATION = "draft.schedule" as const;
export const SCHEDULE_CANCEL_OPERATION = "draft.schedule.cancel" as const;

const MS_PER_SECOND = 1_000;
// Contract-published shape (see packages/contracts/src/api/drafts.ts):
// seconds and fraction are optional. `Date(...)` parses both, so the
// hour-minute-only form is accepted; the resolver normalizes to a
// stable canonical Date.
const ISO_NO_FRACTION_RE =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

export type Clock = () => Date;

export const systemClock: Clock = () => new Date();

export function toD1Timestamp(instant: Date): string {
  // Floor milliseconds: D1's `strftime('%Y-%m-%d %H:%M:%f', ...)` produces
  // `YYYY-MM-DD HH:MM:SS.mmm`, but the existing `idx_outbound_jobs_dispatch`
  // index only relies on second-level ordering, so a one-millisecond rounding
  // error is well below the scheduling window's 90-second minimum lead time.
  const pad = (value: number, width: number) =>
    value.toString().padStart(width, "0");
  return (
    `${instant.getUTCFullYear()}-` +
    `${pad(instant.getUTCMonth() + 1, 2)}-` +
    `${pad(instant.getUTCDate(), 2)} ` +
    `${pad(instant.getUTCHours(), 2)}:` +
    `${pad(instant.getUTCMinutes(), 2)}:` +
    `${pad(instant.getUTCSeconds(), 2)}.` +
    `${pad(instant.getUTCMilliseconds(), 3)}`
  );
}

export function toIsoFromD1(value: string | null | undefined): string | null {
  if (!value) return null;
  // `available_at` is stored as `YYYY-MM-DD HH:MM:SS[.fff]` in UTC. Treat any
  // already-ISO value as opaque, since callers sometimes echo through raw ISO
  // from the API layer (the contract returns the same string the service
  // stored). Falls through to Date.parse for anything that looks parseable.
  if (value.includes("T")) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const match = value.match(
    /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(\.\d{1,6})?$/,
  );
  if (!match) return null;
  const date = new Date(`${match[1]}T${match[2]}Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export type ResolvedSchedule = {
  instant: Date;
  availableAtText: string;
};

/**
 * Resolves a user-supplied `scheduledAt` against the injected `now` and
 * returns the canonical UTC instant and its D1 text.
 *
 * Hard-fails `SCHEDULE_WINDOW_EXCEEDED` (400) for any instant outside the
 * inclusive window `[now + 90s, now + 30d]`. Past times are therefore also
 * a window failure — the schedule endpoint never degrades into an immediate
 * send, so the caller never has to disambiguate "scheduled" from
 * "queued/sent" in the response.
 */
export function resolveScheduleInstant(
  value: string,
  now: Date,
): ResolvedSchedule {
  const match = value.match(ISO_NO_FRACTION_RE);
  if (!match) {
    throw new DomainError(
      "SCHEDULE_WINDOW_EXCEEDED",
      "scheduledAt must be an ISO 8601 instant with an explicit UTC offset",
      400,
    );
  }
  const normalised = `${match[1]}${match[2]}${match[4]}`;
  const instant = new Date(normalised);
  if (Number.isNaN(instant.getTime())) {
    throw new DomainError(
      "SCHEDULE_WINDOW_EXCEEDED",
      "scheduledAt is not a real calendar instant",
      400,
    );
  }
  const offsetSeconds = Math.floor(
    (instant.getTime() - now.getTime()) / MS_PER_SECOND,
  );
  if (
    offsetSeconds < SCHEDULE_MIN_LEAD_SECONDS ||
    offsetSeconds > SCHEDULE_MAX_LEAD_SECONDS
  ) {
    throw new DomainError(
      "SCHEDULE_WINDOW_EXCEEDED",
      "scheduledAt must be within 90 seconds to 30 days from now",
      400,
    );
  }
  return {
    instant,
    availableAtText: toD1Timestamp(instant),
  };
}

/**
 * Generic SHA-256 → hex helper. Exported so other modules (e.g. `send`) can
 * share the same digest primitive while keeping their own canonical input
 * shape — `draft.send` hashes `JSON.stringify({ draftId, version })`
 * directly, while `draft.schedule` / `draft.schedule.cancel` go through
 * `hashScheduleRequest` below to namespace the operation into the digest.
 */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * Canonical, property-order-independent hash for schedule/cancel idempotency
 * records. The `operation` namespace is the only piece that distinguishes a
 * schedule POST from a cancel DELETE: a re-POST with the same `scheduledAt`
 * and `version` reuses the cached response, while a reschedule with a
 * different `scheduledAt` correctly fails `IDEMPOTENCY_KEY_REUSED` so the
 * client can tell a key collision from a retry. Cancel passes `scheduledAt:
 * ""` because the target time is not part of the request.
 */
export async function hashScheduleRequest(input: {
  operation: typeof SCHEDULE_OPERATION | typeof SCHEDULE_CANCEL_OPERATION;
  draftId: string;
  version: string;
  scheduledAt: string;
}): Promise<string> {
  const canonical = JSON.stringify(
    Object.keys(input)
      .sort()
      .reduce<Record<string, string>>((acc, key) => {
        acc[key] = input[key as keyof typeof input];
        return acc;
      }, {}),
  );
  return sha256Hex(canonical);
}

/**
 * `SELECT` fragment used by `list`/`get` to surface `scheduled_at` without
 * materialising the whole `outbound_jobs` row. Returns `NULL` when there is
 * no pending future schedule (e.g. the job has already been enqueued or
 * cancelled), so the response shape is stable. The fragment correlates on
 * `m.id`, so the outer query **must** alias `messages` as `m` (the draft
 * service does this in every place the fragment is used).
 */
export const SCHEDULED_AT_SELECT = `
  (SELECT oj.available_at
     FROM outbound_jobs oj
    WHERE oj.message_id = m.id
      AND oj.status = 'pending'
      AND oj.available_at > CURRENT_TIMESTAMP
    ORDER BY oj.available_at ASC
    LIMIT 1) AS scheduled_at
`;
