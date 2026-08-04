import { describe, expect, it } from "vitest";
import {
  parseHeartbeat,
  shouldWriteHeartbeat,
} from "../../src/modules/maintenance/heartbeat";

describe("heartbeat", () => {
  it("parses the JSON shape", () => {
    const now = Date.now();
    const parsed = parseHeartbeat(
      JSON.stringify({ timestamp: now, status: "degraded", reason: "boom" }),
    );
    expect(parsed).toEqual({
      timestamp: now,
      status: "degraded",
      reason: "boom",
    });
  });

  it("accepts the legacy plain-number shape", () => {
    const now = Date.now();
    expect(parseHeartbeat(String(now))).toEqual({
      timestamp: now,
      status: "ok",
    });
  });

  it("returns null for malformed input", () => {
    expect(parseHeartbeat(null)).toBeNull();
    expect(parseHeartbeat("")).toBeNull();
    expect(parseHeartbeat("{not-json")).toBeNull();
    expect(parseHeartbeat(JSON.stringify({}))).toBeNull();
  });

  describe("shouldWriteHeartbeat", () => {
    it("writes every minute when degraded", () => {
      const now = Date.now();
      // Minute 7 — healthy path would skip, but the degraded keepalive wins.
      const t = new Date(now);
      t.setUTCMinutes(7);
      expect(
        shouldWriteHeartbeat(
          { timestamp: now, status: "ok" },
          "degraded",
          t.getTime(),
        ),
      ).toBe("degraded-keepalive");
    });

    it("writes once per hour when healthy and at minute 0", () => {
      const t = new Date("2026-01-01T10:00:00Z").getTime();
      expect(shouldWriteHeartbeat(null, "ok", t)).toBe("ok-hourly");
    });

    it("writes a recovery heartbeat when transitioning back to healthy", () => {
      const t = new Date("2026-01-01T10:07:00Z").getTime();
      expect(
        shouldWriteHeartbeat(
          { timestamp: t - 60_000, status: "degraded" },
          "ok",
          t,
        ),
      ).toBe("ok-recovery");
    });

    it("skips healthy ticks that are not at minute 0 and not recoveries", () => {
      const t = new Date("2026-01-01T10:07:00Z").getTime();
      expect(shouldWriteHeartbeat(null, "ok", t)).toBe("skipped");
      expect(
        shouldWriteHeartbeat({ timestamp: t - 60_000, status: "ok" }, "ok", t),
      ).toBe("skipped");
    });
  });
});
