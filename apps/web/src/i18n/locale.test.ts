import { describe, expect, it } from "vitest";
import { resolveInitialLocale } from "./locale";

describe("resolveInitialLocale", () => {
  it("prefers a valid persisted locale", () => {
    expect(resolveInitialLocale("zh-CN", ["en-SG"])).toBe("zh-CN");
  });

  it("normalizes every Chinese browser locale", () => {
    expect(resolveInitialLocale(null, ["zh-Hant-TW", "en"])).toBe("zh-CN");
  });

  it("rejects test-only and unknown persisted locales in production", () => {
    expect(resolveInitialLocale("ar-XB", ["en-SG"], false)).toBe("en");
    expect(resolveInitialLocale("fr", ["zh-SG"])).toBe("zh-CN");
  });

  it("allows pseudo RTL only in test or development", () => {
    expect(resolveInitialLocale("ar-XB", ["en-SG"], true)).toBe("ar-XB");
  });
});
