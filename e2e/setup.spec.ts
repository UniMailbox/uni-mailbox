import { expect, test } from "@playwright/test";

test("initial setup checklist can be completed locally", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("Initial setup")).toBeVisible();
  await expect(page.getByLabel("Setup 0% complete")).toBeVisible();

  await page.getByRole("button", { name: /Create Cloudflare resources/ }).click();
  await expect(page.getByLabel("Setup 20% complete")).toBeVisible();

  await page.getByLabel("Worker API URL").fill("http://127.0.0.1:8787");
  await expect(page.getByLabel("Worker API URL")).toHaveValue("http://127.0.0.1:8787");
});
