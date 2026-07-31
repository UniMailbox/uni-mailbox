import { describe, expect, it } from "vitest";
import {
  formatByteSize,
  formatCount,
  formatDate,
  formatKibibytes,
  formatNumber,
  formatRelativeDate,
} from "./format";

describe("locale-aware formatters", () => {
  it("formats a fixed UTC date in English and Chinese", () => {
    const value = new Date("2026-07-31T00:00:00.000Z");

    expect(formatDate(value, "en")).toBe("Jul 31, 2026");
    expect(formatDate(value, "zh-CN")).toBe("2026年7月31日");
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
      formatRelativeDate("2026-07-31 08:15:00", "en", new Date("2026-07-31T12:00:00Z")),
    ).toBe("8:15 AM");
    expect(
      formatRelativeDate("2026-07-30 08:15:00", "zh-CN", new Date("2026-07-31T12:00:00Z")),
    ).toBe("7月30日");
  });
});
