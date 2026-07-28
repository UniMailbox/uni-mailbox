import { expect, test } from "@playwright/test";

test("login route surfaces an accessible credential form", async ({ page }) => {
  await page.route("**/api/v1/**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ data: { accessToken: "stubbed-token" } }),
    });
  });
  await page.goto("/login");

  await expect(
    page.getByRole("heading", { name: "Sign in to your mail plane." }),
  ).toBeVisible();
  await expect(page.getByLabel("Email address")).toBeEditable();
  await expect(page.getByLabel("Password")).toHaveAttribute(
    "autocomplete",
    "current-password",
  );
});

test("login form posts credentials and routes to the inbox", async ({
  page,
}) => {
  let submittedEmail = "";
  let submittedPassword = "";
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    if (request.url().endsWith("/auth/login")) {
      const body = request.postDataJSON() as Record<string, string>;
      submittedEmail = body.email ?? "";
      submittedPassword = body.password ?? "";
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            accessToken: "access-token",
            accessTokenExpiresIn: 900,
            refreshTokenExpiresAt: "2099-01-01T00:00:00.000Z",
          },
        }),
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ data: [] }),
    });
  });
  await page.goto("/login");

  await page.getByLabel("Email address").fill("operator@example.com");
  await page.getByLabel("Password").fill("correct horse battery staple");
  await page.getByRole("button", { name: /Enter workspace/ }).click();

  await expect.poll(() => submittedEmail).toBe("operator@example.com");
  expect(submittedPassword.length).toBeGreaterThan(0);
});
