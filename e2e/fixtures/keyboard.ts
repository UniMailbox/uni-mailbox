import { expect, type Locator, type Page } from "@playwright/test";

export async function expectKeyboardFocusSequence(
  page: Page,
  targets: readonly Locator[],
) {
  await page.locator("body").focus();

  for (const target of targets) {
    await page.keyboard.press("Tab");
    await expect(target).toBeVisible();
    await expect(target).toBeFocused();
    await expect
      .poll(() =>
        target.evaluate((element) => element.matches(":focus-visible")),
      )
      .toBe(true);
  }
}
