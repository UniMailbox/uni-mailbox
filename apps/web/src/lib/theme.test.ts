import { beforeEach, describe, expect, it } from "vitest";
import {
  applyThemeColor,
  DEFAULT_THEME_COLOR,
  normalizeThemeColor,
  resolveInitialThemeColor,
  themePalette,
} from "./theme";

describe("theme color preferences", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("style");
    document.head.innerHTML = '<meta name="theme-color" content="#11231d">';
  });

  it("normalizes full hexadecimal colors and rejects unsafe values", () => {
    expect(normalizeThemeColor(" #2563EB ")).toBe("#2563eb");
    expect(normalizeThemeColor("#fff")).toBeNull();
    expect(normalizeThemeColor("red")).toBeNull();
    expect(resolveInitialThemeColor("not-a-color")).toBe(DEFAULT_THEME_COLOR);
  });

  it("derives readable interface shades while retaining the selected color", () => {
    const palette = themePalette("#f59e0b");

    expect(palette.themeColor).toBe("#f59e0b");
    expect(palette.forest).not.toBe(palette.themeColor);
    expect(palette.mint).toMatch(/^#[0-9a-f]{6}$/u);
    expect(themePalette("#888888").forest).toMatch(/^#([0-9a-f]{2})\1\1$/u);
  });

  it("applies the palette to document variables and browser chrome", () => {
    applyThemeColor("#2563eb");

    expect(
      document.documentElement.style.getPropertyValue("--theme-color"),
    ).toBe("#2563eb");
    expect(document.documentElement.style.getPropertyValue("--forest")).toMatch(
      /^#[0-9a-f]{6}$/u,
    );
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe(
      themePalette("#2563eb").forest,
    );
    expect(document.documentElement.style.getPropertyValue("--ring")).toBe(
      themePalette("#2563eb").focus,
    );
    expect(
      document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
        ?.content,
    ).toBe(themePalette("#2563eb").forestDeep);
  });
});
