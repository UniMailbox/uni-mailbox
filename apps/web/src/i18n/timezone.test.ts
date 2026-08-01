import { describe, expect, it } from "vitest";
import {
  isValidTimeZone,
  resolveInitialTimeZone,
  supportedTimeZones,
} from "./timezone";

describe("time-zone preferences", () => {
  it("prefers a valid persisted zone and falls back to detection or UTC", () => {
    expect(resolveInitialTimeZone("Asia/Singapore", "Europe/London")).toBe(
      "Asia/Singapore",
    );
    expect(resolveInitialTimeZone("invalid", "Europe/London")).toBe(
      "Europe/London",
    );
    expect(resolveInitialTimeZone(null, "invalid")).toBe("UTC");
  });

  it("exposes valid selectable IANA zones including UTC", () => {
    expect(isValidTimeZone("Asia/Singapore")).toBe(true);
    expect(isValidTimeZone("not/a-zone")).toBe(false);
    expect(supportedTimeZones()).toContain("UTC");
    expect(supportedTimeZones()).toContain("Asia/Singapore");
  });
});
