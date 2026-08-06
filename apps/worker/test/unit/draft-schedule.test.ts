import { describe, expect, it } from "vitest";
import { DomainError } from "@unimailbox/contracts";
import {
  SCHEDULE_MAX_LEAD_SECONDS,
  SCHEDULE_MIN_LEAD_SECONDS,
  hashScheduleRequest,
  resolveScheduleInstant,
  sha256Hex,
  toD1Timestamp,
  toIsoFromD1,
} from "../../src/modules/messages/schedule";

const NOW = new Date("2026-08-06T12:00:00.000Z");

function atOffset(seconds: number, base: Date = NOW): Date {
  return new Date(base.getTime() + seconds * 1_000);
}

describe("resolveScheduleInstant", () => {
  it("treats Z and explicit +08:00 offsets pointing at the same instant as equivalent", () => {
    const zulu = resolveScheduleInstant("2026-08-06T14:00:00Z", NOW);
    const east = resolveScheduleInstant("2026-08-06T22:00:00+08:00", NOW);
    expect(zulu.instant.toISOString()).toBe(east.instant.toISOString());
    expect(zulu.availableAtText).toBe(east.availableAtText);
  });

  it("treats explicit -05:00 offsets the same as their UTC equivalent", () => {
    const zulu = resolveScheduleInstant("2026-08-06T15:00:00Z", NOW);
    const west = resolveScheduleInstant("2026-08-06T10:00:00-05:00", NOW);
    expect(zulu.instant.toISOString()).toBe(west.instant.toISOString());
  });

  it("flags any instant inside the 90-second lead time as a window failure", () => {
    expect(() =>
      resolveScheduleInstant(
        atOffset(SCHEDULE_MIN_LEAD_SECONDS - 1).toISOString(),
        NOW,
      ),
    ).toThrowError(DomainError);
    try {
      resolveScheduleInstant(
        atOffset(SCHEDULE_MIN_LEAD_SECONDS - 1).toISOString(),
        NOW,
      );
    } catch (error) {
      expect((error as DomainError).code).toBe("SCHEDULE_WINDOW_EXCEEDED");
      expect((error as DomainError).status).toBe(400);
    }
    // Exactly 90 s in the future is the inclusive lower bound.
    expect(() =>
      resolveScheduleInstant(
        atOffset(SCHEDULE_MIN_LEAD_SECONDS).toISOString(),
        NOW,
      ),
    ).not.toThrow();
  });

  it("accepts the 30-day horizon as inclusive", () => {
    const horizon = resolveScheduleInstant(
      atOffset(SCHEDULE_MAX_LEAD_SECONDS).toISOString(),
      NOW,
    );
    expect(horizon.instant.toISOString()).toBe(
      atOffset(SCHEDULE_MAX_LEAD_SECONDS).toISOString(),
    );
  });

  it("rejects instants beyond the 30-day horizon", () => {
    expect(() =>
      resolveScheduleInstant(
        atOffset(SCHEDULE_MAX_LEAD_SECONDS + 1).toISOString(),
        NOW,
      ),
    ).toThrowError(DomainError);
    try {
      resolveScheduleInstant(
        atOffset(SCHEDULE_MAX_LEAD_SECONDS + 1).toISOString(),
        NOW,
      );
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe("SCHEDULE_WINDOW_EXCEEDED");
      expect((error as DomainError).status).toBe(400);
    }
  });

  it("flags any instant in the past as a window failure (no 'immediate' degradation)", () => {
    expect(() =>
      resolveScheduleInstant(
        new Date(NOW.getTime() - 60 * 60 * 1_000).toISOString(),
        NOW,
      ),
    ).toThrowError(DomainError);
    try {
      resolveScheduleInstant(
        new Date(NOW.getTime() - 60 * 60 * 1_000).toISOString(),
        NOW,
      );
    } catch (error) {
      expect((error as DomainError).code).toBe("SCHEDULE_WINDOW_EXCEEDED");
    }
  });

  it("rejects malformed ISO strings with SCHEDULE_WINDOW_EXCEEDED", () => {
    expect(() =>
      resolveScheduleInstant("2026-08-06 12:00:00", NOW),
    ).toThrowError(DomainError);
    expect(() => resolveScheduleInstant("not-a-date", NOW)).toThrowError(
      DomainError,
    );
    try {
      resolveScheduleInstant("not-a-date", NOW);
    } catch (error) {
      expect((error as DomainError).code).toBe("SCHEDULE_WINDOW_EXCEEDED");
    }
  });
});

describe("toD1Timestamp", () => {
  it("formats a UTC Date as the canonical 'YYYY-MM-DD HH:MM:SS.mmm' D1 string", () => {
    const date = new Date("2026-08-06T01:02:03.045Z");
    expect(toD1Timestamp(date)).toBe("2026-08-06 01:02:03.045");
  });

  it("floors sub-millisecond fractions to three digits", () => {
    const date = new Date("2026-01-01T00:00:00.001Z");
    expect(toD1Timestamp(date)).toBe("2026-01-01 00:00:00.001");
  });

  it("lexicographically orders as time-ordering (used by the index)", () => {
    const a = toD1Timestamp(new Date("2026-08-06T12:00:00.000Z"));
    const b = toD1Timestamp(new Date("2026-08-06T12:00:01.000Z"));
    expect(a < b).toBe(true);
  });
});

describe("toIsoFromD1", () => {
  it("round-trips the canonical D1 timestamp into a Z ISO string", () => {
    expect(toIsoFromD1("2026-08-06 12:00:00.000")).toBe(
      "2026-08-06T12:00:00.000Z",
    );
    expect(toIsoFromD1("2026-08-06 12:00:00")).toBe("2026-08-06T12:00:00.000Z");
  });

  it("passes through already-ISO values unchanged", () => {
    expect(toIsoFromD1("2026-08-06T12:00:00.000Z")).toBe(
      "2026-08-06T12:00:00.000Z",
    );
  });

  it("returns null for nullish or garbage input", () => {
    expect(toIsoFromD1(null)).toBeNull();
    expect(toIsoFromD1(undefined)).toBeNull();
    expect(toIsoFromD1("")).toBeNull();
    expect(toIsoFromD1("not-a-date")).toBeNull();
  });
});

describe("sha256Hex and hashScheduleRequest", () => {
  it("produces a stable 64-character hex digest", async () => {
    const digest = await sha256Hex("hello");
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).toBe(await sha256Hex("hello"));
  });

  it("hashes the same logical input identically regardless of property order", async () => {
    const base = {
      operation: "draft.schedule" as const,
      draftId: "draft-1",
      version: "v1",
      scheduledAt: "2026-08-06T12:00:00.000Z",
    };
    const reordered = {
      scheduledAt: "2026-08-06T12:00:00.000Z",
      version: "v1",
      draftId: "draft-1",
      operation: "draft.schedule" as const,
    };
    expect(await hashScheduleRequest(base)).toBe(
      await hashScheduleRequest(reordered),
    );
  });

  it("produces different hashes for different schedule instants or versions", async () => {
    const a = await hashScheduleRequest({
      operation: "draft.schedule",
      draftId: "draft-1",
      version: "v1",
      scheduledAt: "2026-08-06T12:00:00.000Z",
    });
    const b = await hashScheduleRequest({
      operation: "draft.schedule",
      draftId: "draft-1",
      version: "v1",
      scheduledAt: "2026-08-07T12:00:00.000Z",
    });
    const c = await hashScheduleRequest({
      operation: "draft.schedule",
      draftId: "draft-1",
      version: "v2",
      scheduledAt: "2026-08-06T12:00:00.000Z",
    });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });

  it("distinguishes schedule from cancel by operation namespace", async () => {
    const schedule = await hashScheduleRequest({
      operation: "draft.schedule",
      draftId: "draft-1",
      version: "v1",
      scheduledAt: "",
    });
    const cancel = await hashScheduleRequest({
      operation: "draft.schedule.cancel",
      draftId: "draft-1",
      version: "v1",
      scheduledAt: "",
    });
    expect(schedule).not.toBe(cancel);
  });
});
