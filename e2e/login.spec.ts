import { expect, test } from "@playwright/test";

test("login route surfaces an accessible credential form", async ({ page }) => {
  await page.route("**/api/v1/**", async (route) => {
    if (route.request().url().endsWith("/auth/session")) {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "AUTH_REQUIRED",
            message: "Authentication is required",
            requestId: "test",
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
  let signedIn = false;
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    if (request.url().endsWith("/auth/login")) {
      const body = request.postDataJSON() as Record<string, string>;
      submittedEmail = body.email ?? "";
      submittedPassword = body.password ?? "";
      signedIn = true;
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
    if (request.url().endsWith("/auth/session")) {
      await route.fulfill({
        status: signedIn ? 200 : 401,
        contentType: "application/json",
        body: JSON.stringify(
          signedIn
            ? {
                data: {
                  userId: "user-1",
                  email: "initial-admin@example.com",
                  permissions: ["message.read"],
                },
              }
            : {
                error: {
                  code: "AUTH_REQUIRED",
                  message: "Authentication is required",
                  requestId: "test",
                },
              },
        ),
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ data: [] }),
    });
  });
  await page.goto("/login");

  await page.getByLabel("Email address").fill("initial-admin@example.com");
  await page.getByLabel("Password").fill("correct horse battery staple");
  await page.getByRole("button", { name: /Enter workspace/ }).click();

  await expect.poll(() => submittedEmail).toBe("initial-admin@example.com");
  expect(submittedPassword.length).toBeGreaterThan(0);
  await expect(page).toHaveURL(/\/inbox$/u);
});

// The e2e harness stubs the Worker (CI does not boot `wrangler dev` alongside
// Playwright). The two tests below pin the front-end side of the route-guard
// contract so the same `pnpm test:e2e` run that catches UI regressions also
// catches the guard breaking.
test("an anonymous visitor landing on /inbox is redirected to /login", async ({
  page,
}) => {
  const protectedCalls: string[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(
      /^\/api\/v1/u,
      "",
    );
    protectedCalls.push(path);
    if (path === "/auth/session" || path === "/auth/refresh") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "AUTH_REQUIRED",
            message: "Authentication is required",
            requestId: "test",
          },
        }),
        status: 401,
      });
      return;
    }
    await route.abort("failed");
  });
  await page.goto("/inbox");

  await expect(page).toHaveURL(/\/login/u);
  // No mailbox/draft/message request must reach the API: the guard aborts
  // before they fire. Otherwise a "broken" guard would look like a slow page.
  expect(protectedCalls.filter((p) => !p.startsWith("/auth/"))).toEqual([]);
});

test("a signed-in operator hitting /login lands on /inbox", async ({
  page,
}) => {
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(
      /^\/api\/v1/u,
      "",
    );
    if (path === "/auth/session") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            userId: "user-1",
            email: "admin@example.com",
            permissions: ["user.read"],
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

  await expect(page).toHaveURL(/\/inbox$/u);
});
