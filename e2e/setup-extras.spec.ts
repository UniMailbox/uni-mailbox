import { expect, test } from "@playwright/test";

test("setup wizard blocks the application routes until complete", async ({ page }) => {
  await page.route("**/api/v1/setup/status", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          installationVersion: 1,
          stateVersion: 0,
          currentStep: "preflight",
          completedSteps: ["claim"],
        },
      }),
    });
  });
  await page.goto("/setup");

  await expect(
    page.getByRole("heading", { name: "Bring your mail plane online." }),
  ).toBeVisible();
  await expect(page.getByText("Verify resources")).toBeVisible();
});

test("admin route shows the user table when the system is complete", async ({
  page,
}) => {
  await page.route("**/api/v1/setup/status", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          installationVersion: 1,
          stateVersion: 9,
          currentStep: "complete",
          completedSteps: [],
        },
      }),
    });
  });
  await page.route("**/api/v1/admin/users", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            email: "admin@example.com",
            display_name: "Administrator",
            status: "active",
          },
        ],
      }),
    });
  });
  await page.goto("/admin/users");

  await expect(page.getByText("admin@example.com")).toBeVisible();
  await expect(page.getByText("Administrator")).toBeVisible();
});