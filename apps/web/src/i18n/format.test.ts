import { describe, expect, it } from "vitest";
import { formatDate, formatKibibytes, formatNumber } from "./format";

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
});
