import { expect, test } from "./fixtures/locale";

const mailboxId = "11111111-1111-4111-8111-111111111111";

test("pseudo RTL keeps layout, directional controls, and technical values readable", async ({ page }) => {
  await page.route("**/api/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/auth/session")) return route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: { userId: "operator-1", email: "operator@example.com", permissions: ["message.read"] } }) });
    if (path === "/api/v1/mailboxes") return route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: [{ id: mailboxId, address: "ops@example.com", display_name: "Operations", status: "active", domain_id: mailboxId, role: "owner" }] }) });
    if (path.includes("/messages")) return route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: { items: [{ id: "55555555-5555-4555-8555-555555555555", from_address: "sender@example.net", from_name: "Sender", subject: "Status update", status: "received", created_at: "2026-07-27 09:00:00", is_read: 0, is_starred: 0 }], nextCursor: null } }) });
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: [] }) });
  });
  await page.goto(`/inbox/${mailboxId}`);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute("lang", "ar-XB");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  const sidebar = page.locator(".mail-sidebar");
  if ((await page.viewportSize())?.width ?? 0 > 700) {
    const box = await sidebar.boundingBox();
    expect(box && box.x + box.width).toBeGreaterThanOrEqual(((await page.viewportSize())?.width ?? 0) - 1);
  } else {
    await page.locator(".mobile-menu").click();
    await expect(sidebar).toHaveClass(/open/u);
    const box = await sidebar.boundingBox();
    expect(box && box.x + box.width).toBeGreaterThanOrEqual(((await page.viewportSize())?.width ?? 0) - 1);
  }
  await page.locator(".compose-button").click();
  const composer = page.locator(".compose-panel");
  await expect(composer).toBeVisible();
  const composerBox = await composer.boundingBox();
  expect(composerBox?.x).toBeLessThanOrEqual(30);
  await expect(page.locator("bdi[dir=ltr]").first()).toContainText("sender@example.net");
  await expect(page.locator("bdi[dir=auto]").first()).toContainText("Sender");
  await expect(page.locator(".directional-icon").first()).toHaveCSS("transform", "matrix(-1, 0, 0, 1, 0, 0)");
  await expect(page.locator(".compose-button svg").first()).toHaveCSS("transform", "none");
});

test("pseudo RTL keeps request UUIDs LTR-isolated", async ({ page }) => {
  const requestId = "11111111-1111-4111-8111-111111111111";
  await page.route("**/api/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/auth/session")) return route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: { userId: "operator-1", email: "operator@example.com", permissions: ["settings.manage"] } }) });
    if (path.endsWith("/admin/infrastructure")) return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "UNKNOWN_SERVER_ERROR", requestId } }) });
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: [] }) });
  });
  await page.goto("/settings/storage");
  await expect(page.locator(".request-id bdi[dir=ltr]")).toHaveText(requestId);
});
