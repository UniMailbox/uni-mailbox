import { expect, test } from "./fixtures/locale";

test("language preference applies immediately and persists after reload", async ({ page, uiLocale }) => {
  await page.route("**/api/v1/auth/session", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ data: { userId: "operator-1", email: "operator@example.com", permissions: ["settings.manage"] } }),
  }));
  await page.goto("/settings/preferences");

  await expect(page.locator("html")).toHaveAttribute("lang", uiLocale.code);
  await expect(page.getByRole("heading", { name: uiLocale.copy.preferences })).toBeVisible();
  await page.getByLabel(uiLocale.copy.language).selectOption(uiLocale.code === "en" ? "zh-CN" : "en");
  const expected = uiLocale.code === "en" ? "zh-CN" : "en";
  await expect(page.locator("html")).toHaveAttribute("lang", expected);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", expected);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("unimailbox.locale"))).toBe(expected);
});

test("authorized administration uses localized navigation", async ({ page, uiLocale }) => {
  let created = false;
  await page.route("**/api/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/auth/session")) {
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: { userId: "operator-1", email: "operator@example.com", permissions: ["user.read", "user.manage"] } }) });
    }
    if (path.endsWith("/admin/users") && route.request().method() === "POST") {
      created = true;
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ data: { id: "11111111-1111-4111-8111-111111111111", email: "operator@example.com" } }) });
    }
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: [] }) });
  });
  await page.goto("/admin/users");
  await expect(page.getByRole("heading", { name: uiLocale.copy.users })).toBeVisible();
  await expect(page.getByText(uiLocale.copy.administration)).toBeVisible();
  await page.locator(".create-panel summary").first().click();
  await page.getByLabel(uiLocale.copy.displayName).fill("Operator");
  await page.getByLabel(uiLocale.copy.emailField).fill("operator@example.com");
  await page.getByLabel(uiLocale.copy.passwordField).fill("correct horse battery staple");
  await page.getByLabel(uiLocale.copy.roleIds).fill("11111111-1111-4111-8111-111111111111");
  await page.getByRole("button", { name: uiLocale.copy.create }).click();
  await expect.poll(() => created).toBe(true);
});
