import { describe, expect, it } from "vitest";
import {
  formatByteSize,
  formatCount,
  formatDate,
  formatDateTime,
  formatKibibytes,
  formatNumber,
  formatRelativeDate,
  formatTimestamp,
} from "./format";

describe("locale-aware formatters", () => {
  it("formats a fixed UTC date in English and Chinese", () => {
    const value = new Date("2026-07-31T00:00:00.000Z");

    expect(formatDate(value, "en")).toBe("Jul 31, 2026");
    expect(formatDate(value, "zh-CN")).toBe("2026年7月31日");
  });

  it("formats the same timestamp in the selected time zone", () => {
    const value = new Date("2026-07-31T23:30:00.000Z");

    expect(formatDate(value, "en", "America/Los_Angeles")).toBe("Jul 31, 2026");
    expect(formatDate(value, "en", "Asia/Singapore")).toBe("Aug 1, 2026");
    expect(formatDateTime(value, "en", "Asia/Singapore")).toContain("7:30 AM");
    expect(
      formatTimestamp("2026-07-31 23:30:00", "zh-CN", "Asia/Singapore"),
    ).toContain("07:30");
  });

  it("formats numbers using the supplied locale", () => {
    expect(formatNumber(1234567.89, "en")).toBe("1,234,567.89");
    expect(formatNumber(1234567.89, "zh-CN")).toBe("1,234,567.89");
  });

  it("formats attachment KiB using the supplied locale and a unit", () => {
    expect(formatKibibytes(1536, "en")).toContain("1.5");
    expect(formatKibibytes(1536, "zh-CN")).toContain("1.5");
  });

  it("formats counts, byte sizes, and relative dates with an explicit locale", () => {
    expect(formatCount(1, "en")).toBe("1 item");
    expect(formatCount(2, "zh-CN")).toBe("2 项");
    expect(formatByteSize(1_536, "en")).toContain("1.5");
    expect(formatByteSize(1_536, "zh-CN")).toContain("1.5");
    expect(
      formatRelativeDate(
        "2026-07-31 08:15:00",
        "en",
        "UTC",
        new Date("2026-07-31T12:00:00Z"),
      ),
    ).toBe("8:15 AM");
    expect(
      formatRelativeDate(
        "2026-07-30 08:15:00",
        "zh-CN",
        "UTC",
        new Date("2026-07-31T12:00:00Z"),
      ),
    ).toBe("7月30日");
  });

  it("decides whether a message is from today in the selected time zone", () => {
    const now = new Date("2026-08-01T00:30:00Z");

    expect(
      formatRelativeDate("2026-07-31T23:30:00Z", "en", "Asia/Singapore", now),
    ).toBe("7:30 AM");
    expect(
      formatRelativeDate(
        "2026-07-31T23:30:00Z",
        "en",
        "America/Los_Angeles",
        now,
      ),
    ).toBe("4:30 PM");
  });
});
