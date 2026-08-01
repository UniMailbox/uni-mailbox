import { expect, test } from "./fixtures/locale";
import { expectKeyboardFocusSequence } from "./fixtures/keyboard";
import { messageDetailFixture, messageId } from "./fixtures/message-detail";
import { anonymousSessionError } from "./fixtures/session";

const mailboxId = "11111111-1111-4111-8111-111111111111";

test("pseudo RTL keyboard-only login focus sequence", async ({ page }) => {
  await page.route("**/api/v1/**", async (route) => {
    if (route.request().url().endsWith("/auth/session")) {
      await route.fulfill({
        contentType: "application/json",
        status: 401,
        body: JSON.stringify(anonymousSessionError),
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ data: [] }),
    });
  });
  await page.goto("/login");

  const email = page.locator('input[type="email"]');
  await expect(email).toHaveAttribute("dir", "ltr");
  await expectKeyboardFocusSequence(page, [
    page.getByRole("link", { name: /UniMailbox/u }),
    email,
    page.locator('input[type="password"]'),
    page.locator('button[type="submit"]'),
  ]);
});

test("pseudo RTL keeps layout, directional controls, and technical values readable", async ({
  page,
}) => {
  await page.route("**/api/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/auth/session"))
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            userId: "operator-1",
            email: "operator@example.com",
            permissions: ["message.read"],
          },
        }),
      });
    if (path === "/api/v1/mailboxes")
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: [
            {
              id: mailboxId,
              address: "ops@example.com",
              display_name: "Operations",
              status: "active",
              domain_id: mailboxId,
              role: "owner",
            },
          ],
        }),
      });
    if (path === `/api/v1/messages/${messageId}`)
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ data: messageDetailFixture }),
      });
    if (path.includes("/messages"))
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            items: [
              {
                id: messageId,
                from_address: "sender@example.net",
                from_name: "Sender",
                subject: "Status update",
                status: "received",
                created_at: "2026-07-27 09:00:00",
                is_read: 0,
                is_starred: 0,
              },
            ],
            nextCursor: null,
          },
        }),
      });
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ data: [] }),
    });
  });
  await page.goto(`/inbox/${mailboxId}`);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute("lang", "ar-XB");
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);

  const sidebar = page.locator(".mail-sidebar");
  if (((await page.viewportSize())?.width ?? 0) > 700) {
    const box = await sidebar.boundingBox();
    expect(box && box.x + box.width).toBeGreaterThanOrEqual(
      ((await page.viewportSize())?.width ?? 0) - 1,
    );
  } else {
    await page.locator(".mobile-menu").click();
    await expect(sidebar).toHaveClass(/open/u);
    const viewportWidth = (await page.viewportSize())?.width ?? 0;
    await expect
      .poll(async () => {
        const box = await sidebar.boundingBox();
        return Boolean(
          box && box.x >= -1 && box.x + box.width <= viewportWidth + 1,
        );
      })
      .toBe(true);
  }
  const composeButton = page.locator(".compose-button");
  await composeButton.click();
  const composer = page.locator(".compose-panel");
  await expect(composer).toBeVisible();
  const composerBox = await composer.boundingBox();
  expect(composerBox?.x).toBeLessThanOrEqual(30);
  const firstMessageSender = page.locator(".message-sender").first();
  await expect(firstMessageSender.locator("bdi[dir=ltr]")).toContainText(
    "sender@example.net",
  );
  await expect(firstMessageSender.locator("bdi[dir=auto]")).toContainText(
    "Sender",
  );
  await expect(page.locator(".compose-button svg").first()).toHaveCSS(
    "transform",
    "none",
  );
  await page.goto(`/messages/${messageId}`);
  await expect(page.locator(".directional-icon").first()).toHaveCSS(
    "transform",
    "matrix(-1, 0, 0, 1, 0, 0)",
  );
});

test("pseudo RTL keeps request UUIDs LTR-isolated", async ({ page }) => {
  const requestId = "11111111-1111-4111-8111-111111111111";
  await page.route("**/api/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/auth/session"))
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            userId: "operator-1",
            email: "operator@example.com",
            permissions: ["settings.read", "settings.manage"],
          },
        }),
      });
    if (path.endsWith("/admin/settings"))
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            site_title: "UniMailbox",
            registration_enabled: 0,
            invite_required: 1,
            inbound_enabled: 1,
            outbound_enabled: 1,
            unknown_recipient_policy: "reject",
            max_mailboxes_per_user: 10,
            max_attachments_per_message: 20,
            max_attachment_bytes: 25_000_000,
            sender_blocklist_json: "[]",
            subject_blocklist_json: "[]",
            content_blocklist_json: "[]",
          },
        }),
      });
    if (path.endsWith("/admin/infrastructure"))
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "UNKNOWN_SERVER_ERROR",
            message: "ignored diagnostic",
            requestId,
          },
        }),
      });
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ data: [] }),
    });
  });
  await page.goto("/admin/settings");
  await expect(page.locator(".request-id bdi[dir=ltr]")).toHaveText(requestId);
});
