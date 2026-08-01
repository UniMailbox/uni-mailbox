import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LOCALE_STORAGE_KEY } from "./locale";
import { createTestI18n } from "./test-instance";

describe("i18n document synchronization", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.lang = "en";
    document.documentElement.dir = "ltr";
    document.title = "";
    document.head.innerHTML = '<meta name="description" content="" />';
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("synchronizes document metadata and persists production locale changes", async () => {
    const i18n = createTestI18n("en");

    await i18n.changeLanguage("zh-CN");

    expect(document.documentElement.lang).toBe("zh-CN");
    expect(document.documentElement.dir).toBe("ltr");
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("zh-CN");
    expect(document.title).toBe("UniMailbox");
    expect(
      document
        .querySelector('meta[name="description"]')
        ?.getAttribute("content"),
    ).toBe("安全、私有的邮件工作区");
  });

  it("uses RTL for pseudo locale without persisting it", () => {
    createTestI18n("ar-XB");

    expect(document.documentElement.dir).toBe("rtl");
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull();
  });
});
