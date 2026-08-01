import { copyFor, expect, test } from "./fixtures/locale";
import { anonymousSessionError, sessionProfile } from "./fixtures/session";

const mailboxId = "11111111-1111-4111-8111-111111111111";

test("language preference survives actual logout and login in one context", async ({
  page,
  uiLocale,
}) => {
  let authenticated = true;
  const changedLocale = uiLocale.code === "en" ? "zh-CN" : "en";
  const changedCopy = copyFor(changedLocale);
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/v1/auth/session") {
      return route.fulfill(
        authenticated
          ? {
              contentType: "application/json",
              body: JSON.stringify({ data: sessionProfile(["settings.manage"]) }),
            }
          : {
              status: 401,
              contentType: "application/json",
              body: JSON.stringify(anonymousSessionError),
            },
      );
    }
    if (path === "/api/v1/auth/logout") {
      authenticated = false;
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ data: { revoked: true } }),
      });
    }
    if (path === "/api/v1/auth/login") {
      authenticated = true;
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            accessToken: "e2e-access-token",
            accessTokenExpiresIn: 3_600,
            refreshTokenExpiresAt: "2099-01-01T00:00:00.000Z",
          },
        }),
      });
    }
    if (path === "/api/v1/mailboxes") {
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ data: [] }),
      });
    }
    if (path.includes("/messages")) {
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ data: { items: [], nextCursor: null } }),
      });
    }
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: [] }) });
  });

  await page.goto("/settings/preferences");
  await page.getByLabel(uiLocale.copy.language).selectOption(changedLocale);
  await expect(page.locator("html")).toHaveAttribute("lang", changedLocale);
  await page.goto(`/inbox/${mailboxId}`);
  await page.locator(".mail-topbar").getByRole("button").last().click();
  await expect(page).toHaveURL(/\/login$/u);

  await page.getByLabel(changedCopy.email).fill("operator@example.com");
  await page.getByLabel(changedCopy.password).fill("correct horse battery staple");
  await page.getByRole("button", { name: changedCopy.submit }).click();
  await expect(page).toHaveURL(/\/inbox$/u);
  await expect(page.locator("html")).toHaveAttribute("lang", changedLocale);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("unimailbox.locale")))
    .toBe(changedLocale);
});

test("account email change submits a schema-valid request", async ({ page, uiLocale }) => {
  let requestBody: unknown;
  let authenticated = true;
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/v1/auth/session") {
      return route.fulfill(
        authenticated
          ? {
              contentType: "application/json",
              body: JSON.stringify({ data: sessionProfile(["settings.manage"]) }),
            }
          : {
              status: 401,
              contentType: "application/json",
              body: JSON.stringify(anonymousSessionError),
            },
      );
    }
    if (path === "/api/v1/auth/email" && route.request().method() === "POST") {
      requestBody = route.request().postDataJSON();
      authenticated = false;
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: { email: "new.login@example.com", sessionsRevoked: true },
        }),
      });
    }
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: [] }) });
  });

  await page.goto("/settings/account");
  const emailForm = page.locator(".account-security-grid > div").first();
  await emailForm.getByLabel(uiLocale.copy.accountEmail).fill("new.login@example.com");
  await emailForm.getByLabel(uiLocale.copy.currentPassword).fill("current-password-1234");
  await emailForm.getByRole("button", { name: uiLocale.copy.updateEmail }).click();

  await expect.poll(() => requestBody).toEqual({
    currentPassword: "current-password-1234",
    email: "new.login@example.com",
  });
  await expect(page).toHaveURL(/\/login$/u);
});

test("unknown route renders a localized not-found boundary without replacing its URL", async ({
  page,
  uiLocale,
}) => {
  await page.goto("/not-a-real-route");

  await expect(page.getByRole("alert")).toContainText(uiLocale.copy.notFound);
  await expect(page).toHaveURL(/\/not-a-real-route$/u);
});

test("unsupported settings section renders localized not-found without falling back to storage", async ({ page, uiLocale }) => {
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: sessionProfile(["settings.manage"]) }) }),
  );
  await page.goto("/settings/typo");
  await expect(page.getByRole("alert")).toContainText(uiLocale.copy.notFound);
  await expect(page).toHaveURL(/\/settings\/typo$/u);
  await expect(page.getByText(uiLocale.copy.storageTitle)).toHaveCount(0);
});

test("member is forbidden from an admin resource without losing the URL", async ({
  page,
  uiLocale,
}) => {
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ data: sessionProfile(["message.read"]) }),
    }),
  );
  await page.goto("/admin/users");

  await expect(page.getByRole("alert")).toContainText(uiLocale.copy.forbidden);
  await expect(page).toHaveURL(/\/admin\/users$/u);
});
