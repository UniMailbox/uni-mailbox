import { describe, expect, it } from "vitest";
import { draftEndpoints } from "../src/api";
import { ERROR_CODES } from "../src/api/common/errors";

const draftId = "11111111-1111-4111-8111-111111111111";

describe("draft schedule endpoint contracts", () => {
  it("exposes schedule and cancelSchedule routes under /drafts/:draftId/schedule", () => {
    expect(draftEndpoints.schedule).toMatchObject({
      method: "POST",
      path: "/drafts/:draftId/schedule",
    });
    expect(draftEndpoints.cancelSchedule).toMatchObject({
      method: "DELETE",
      path: "/drafts/:draftId/schedule",
    });
  });

  it("requires if-match and idempotency-key headers on both schedule and cancel", () => {
    expect(
      draftEndpoints.schedule.request?.headers?.parse({
        "if-match": '"2026-08-06T00:00:00.000Z#version"',
        "idempotency-key": "request-1",
      }),
    ).toEqual({
      "if-match": '"2026-08-06T00:00:00.000Z#version"',
      "idempotency-key": "request-1",
    });
    expect(
      draftEndpoints.cancelSchedule.request?.headers?.parse({
        "if-match": '"2026-08-06T00:00:00.000Z#version"',
        "idempotency-key": "request-1",
      }),
    ).toEqual({
      "if-match": '"2026-08-06T00:00:00.000Z#version"',
      "idempotency-key": "request-1",
    });
  });

  it("rejects headers that violate the etag / idempotency-key shape", () => {
    expect(() => draftEndpoints.schedule.request?.headers?.parse({})).toThrow();
    expect(() =>
      draftEndpoints.schedule.request?.headers?.parse({
        "if-match": "",
        "idempotency-key": "",
      }),
    ).toThrow();
    expect(() =>
      draftEndpoints.cancelSchedule.request?.headers?.parse({
        "if-match": '"version"',
        "idempotency-key": "a".repeat(256),
      }),
    ).toThrow();
  });

  it("accepts ISO 8601 instants with an explicit UTC offset or Z", () => {
    const zulu = draftEndpoints.schedule.request?.body?.parse({
      scheduledAt: "2026-08-06T12:00:00Z",
    });
    expect(zulu).toEqual({ scheduledAt: "2026-08-06T12:00:00Z" });
    const offset = draftEndpoints.schedule.request?.body?.parse({
      scheduledAt: "2026-08-06T20:00:00+08:00",
    });
    expect(offset).toEqual({ scheduledAt: "2026-08-06T20:00:00+08:00" });
    const withMillis = draftEndpoints.schedule.request?.body?.parse({
      scheduledAt: "2026-08-06T12:00:00.123Z",
    });
    expect(withMillis).toEqual({ scheduledAt: "2026-08-06T12:00:00.123Z" });
  });

  it("rejects ISO strings that omit the offset (zone would be ambiguous)", () => {
    expect(() =>
      draftEndpoints.schedule.request?.body?.parse({
        scheduledAt: "2026-08-06T12:00:00",
      }),
    ).toThrow(/offset/i);
    expect(() =>
      draftEndpoints.schedule.request?.body?.parse({
        scheduledAt: "2026-08-06 12:00:00",
      }),
    ).toThrow();
    expect(() =>
      draftEndpoints.schedule.request?.body?.parse({
        scheduledAt: "not-a-date",
      }),
    ).toThrow();
  });

  it("rejects impossible calendar instants", () => {
    // Feb 30 is not a valid date; the refine catches what the regex cannot.
    expect(() =>
      draftEndpoints.schedule.request?.body?.parse({
        scheduledAt: "2026-02-30T12:00:00Z",
      }),
    ).toThrow();
  });

  it("echoes the schedule response with status 'scheduled' only", () => {
    const parsed = draftEndpoints.schedule.responses[200].parse({
      messageId: draftId,
      status: "scheduled",
      scheduledAt: "2026-08-06T12:00:00.000Z",
      updatedAt: "2026-08-06T11:58:00.000Z",
    });
    expect(parsed.status).toBe("scheduled");
    // The schedule endpoint never degrades into an immediate send — instants
    // inside the 90-second lead time fail with SCHEDULE_WINDOW_EXCEEDED at
    // the service layer rather than reporting 'queued' or 'sent' here.
    expect(() =>
      draftEndpoints.schedule.responses[200].parse({
        messageId: draftId,
        status: "queued",
        scheduledAt: "2026-08-06T12:00:00.000Z",
        updatedAt: "2026-08-06T11:58:00.000Z",
      }),
    ).toThrow();
    expect(() =>
      draftEndpoints.schedule.responses[200].parse({
        messageId: draftId,
        status: "sent",
        scheduledAt: "2026-08-06T12:00:00.000Z",
        updatedAt: "2026-08-06T11:58:00.000Z",
      }),
    ).toThrow();
    expect(() =>
      draftEndpoints.schedule.responses[200].parse({
        messageId: draftId,
        status: "draft",
        scheduledAt: "2026-08-06T12:00:00.000Z",
        updatedAt: "2026-08-06T11:58:00.000Z",
      }),
    ).toThrow();
  });

  it("rejects schedule responses that drop scheduledAt or use a bogus message id", () => {
    expect(() =>
      draftEndpoints.schedule.responses[200].parse({
        messageId: draftId,
        status: "scheduled",
        scheduledAt: "",
      }),
    ).toThrow();
    expect(() =>
      draftEndpoints.schedule.responses[200].parse({
        messageId: "not-a-uuid",
        status: "scheduled",
        scheduledAt: "2026-08-06T12:00:00.000Z",
        updatedAt: "2026-08-06T11:58:00.000Z",
      }),
    ).toThrow();
  });

  it("exposes the cancel response as a draft status with a cancelled flag", () => {
    expect(
      draftEndpoints.cancelSchedule.responses[200].parse({
        messageId: draftId,
        status: "draft",
        cancelled: true,
        updatedAt: "2026-08-06T11:58:00.000Z",
      }),
    ).toEqual({
      messageId: draftId,
      status: "draft",
      cancelled: true,
      updatedAt: "2026-08-06T11:58:00.000Z",
    });
    expect(
      draftEndpoints.cancelSchedule.responses[200].parse({
        messageId: draftId,
        status: "draft",
        cancelled: false,
        updatedAt: "2026-08-06T11:58:00.000Z",
      }),
    ).toEqual({
      messageId: draftId,
      status: "draft",
      cancelled: false,
      updatedAt: "2026-08-06T11:58:00.000Z",
    });
    expect(() =>
      draftEndpoints.cancelSchedule.responses[200].parse({
        messageId: draftId,
        status: "queued",
        cancelled: true,
      }),
    ).toThrow();
  });

  it("advertises SCHEDULE_WINDOW_EXCEEDED and SCHEDULE_ALREADY_DISPATCHED on schedule errors", () => {
    expect(ERROR_CODES).toContain("SCHEDULE_WINDOW_EXCEEDED");
    expect(ERROR_CODES).toContain("SCHEDULE_ALREADY_DISPATCHED");
    expect(draftEndpoints.schedule.errors).toContain(
      "SCHEDULE_WINDOW_EXCEEDED",
    );
    expect(draftEndpoints.schedule.errors).toContain(
      "SCHEDULE_ALREADY_DISPATCHED",
    );
    expect(draftEndpoints.cancelSchedule.errors).toContain(
      "SCHEDULE_ALREADY_DISPATCHED",
    );
    // Read-side errors inherited by the schedule surface.
    expect(draftEndpoints.schedule.errors).toContain("DRAFT_NOT_FOUND");
    expect(draftEndpoints.schedule.errors).toContain("VALIDATION_FAILED");
  });
});
