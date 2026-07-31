import { expect, test } from "@playwright/test";

test("storage settings show required services and healthy KV without R2", async ({
  page,
}) => {
  await page.route("**/api/v1/auth/session", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ data: { userId: "user-admin-1", email: "admin@example.com", permissions: ["settings.manage"] } }),
    });
  });
  await page.route("**/api/v1/admin/infrastructure", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          required: {
            d1: "ok",
            kv: "ok",
            queue: "ok",
            assets: "ok",
          },
          attachments: {
            backend: "kv",
            r2: "missing",
            reason:
              "ATTACHMENTS binding is absent; KV is the default storage backend",
          },
        },
      }),
    });
  });
  await page.goto("/settings/storage");

  await expect(page.getByText("KV storage is active")).toBeVisible();
  await expect(page.getByText("KV healthy")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Verify R2 write access" }),
  ).toBeDisabled();
});

test("Cloudflare mail configuration is available after login", async ({
  page,
}) => {
  await page.route("**/api/v1/auth/session", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ data: { userId: "user-admin-1", email: "admin@example.com", permissions: ["settings.manage"] } }),
    });
  });
  await page.route("**/api/v1/admin/cloudflare/status", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: [
          {
            checkpointKey: "cloudflare_mail",
            status: "pending",
            metadata: {},
            errorCode: null,
            errorMessage: null,
            verifiedAt: null,
          },
          {
            checkpointKey: "brevo",
            status: "pending",
            metadata: {},
            errorCode: null,
            errorMessage: null,
            verifiedAt: null,
          },
        ],
      }),
    });
  });
  await page.goto("/settings/cloudflare");

  await expect(page.getByText("Connect the control plane")).toBeVisible();
  await expect(page.getByText("Email Routing domain")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Connect Brevo" }),
  ).toBeVisible();
});
