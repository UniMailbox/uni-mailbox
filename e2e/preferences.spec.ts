import { expect, test } from "./fixtures/locale";

test("project locale initializes per context and preserves user choice after reload", async ({
  page,
  uiLocale,
}) => {
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          userId: "operator-1",
          email: "operator@example.com",
          permissions: ["settings.manage"],
        },
      }),
    }),
  );

  const secondPage = await page.context().newPage();
  await secondPage.goto("/login");
  await expect(secondPage.locator("html")).toHaveAttribute(
    "lang",
    uiLocale.code,
  );
  await secondPage.close();

  await page.goto("/settings/preferences");

  await expect(page.locator("html")).toHaveAttribute("lang", uiLocale.code);
  await expect(
    page.getByRole("heading", { name: uiLocale.copy.preferences }),
  ).toBeVisible();
  await page
    .getByLabel(uiLocale.copy.language)
    .selectOption(uiLocale.code === "en" ? "zh-CN" : "en");
  const expected = uiLocale.code === "en" ? "zh-CN" : "en";
  await expect(page.locator("html")).toHaveAttribute("lang", expected);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", expected);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("unimailbox.locale")))
    .toBe(expected);
});

test("authorized administration uses localized navigation", async ({
  page,
  uiLocale,
}) => {
  let created = false;
  let updated = false;
  let deleted = false;
  const existingUserId = "22222222-2222-4222-8222-222222222222";
  await page.route("**/api/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/auth/session")) {
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            userId: "operator-1",
            email: "operator@example.com",
            permissions: ["user.read", "user.manage"],
          },
        }),
      });
    }
    if (path.endsWith("/admin/users") && route.request().method() === "POST") {
      created = true;
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            id: "11111111-1111-4111-8111-111111111111",
            email: "operator@example.com",
          },
        }),
      });
    }
    if (
      path.endsWith(`/admin/users/${existingUserId}`) &&
      route.request().method() === "PATCH"
    ) {
      updated = true;
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: { id: existingUserId, displayName: "Operator Updated" },
        }),
      });
    }
    if (
      path.endsWith(`/admin/users/${existingUserId}`) &&
      route.request().method() === "DELETE"
    ) {
      deleted = true;
      return route.fulfill({ status: 204 });
    }
    if (path.endsWith("/admin/users")) {
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: [
            {
              id: existingUserId,
              email: "lin@example.com",
              display_name: "Lin Qiao",
              status: "active",
              created_at: "2026-08-01 09:30:00",
              roles: "operator",
            },
          ],
        }),
      });
    }
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ data: [] }),
    });
  });
  await page.goto("/admin/users");
  await expect(
    page.getByRole("heading", { name: uiLocale.copy.users }),
  ).toBeVisible();
  await expect(
    page.getByText(uiLocale.copy.administration, { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: uiLocale.copy.addUsers }).click();
  const createDialog = page.getByRole("dialog");
  await createDialog.getByLabel(uiLocale.copy.displayName).fill("Operator");
  await createDialog
    .getByLabel(uiLocale.copy.emailField)
    .fill("operator@example.com");
  await createDialog
    .getByLabel(uiLocale.copy.passwordField)
    .fill("correct horse battery staple");
  await createDialog
    .getByLabel(uiLocale.copy.roleIds)
    .fill("11111111-1111-4111-8111-111111111111");
  await createDialog
    .getByRole("button", { name: uiLocale.copy.create })
    .click();
  await expect.poll(() => created).toBe(true);

  await page.getByRole("button", { name: uiLocale.copy.view }).click();
  await expect(page.getByRole("dialog")).toContainText("lin@example.com");
  await page.getByRole("button", { name: uiLocale.copy.close }).first().click();

  await page.getByRole("button", { name: uiLocale.copy.edit }).click();
  await page
    .getByRole("dialog")
    .getByLabel(uiLocale.copy.displayName)
    .fill("Operator Updated");
  await page.getByRole("button", { name: uiLocale.copy.update }).click();
  await expect.poll(() => updated).toBe(true);

  await page.getByRole("button", { name: uiLocale.copy.delete }).click();
  await expect(page.getByRole("dialog")).toContainText("lin@example.com");
  await page.getByRole("button", { name: uiLocale.copy.deleteRecord }).click();
  await expect.poll(() => deleted).toBe(true);
});
