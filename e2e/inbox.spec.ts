import { expect, test } from "./fixtures/locale";

const mailboxId = "11111111-1111-4111-8111-111111111111";

test("mailbox route loads messages and toggles the sidebar", async ({
  page,
  uiLocale,
}) => {
  let initialPageRequests = 0;
  let paginationRequests = 0;
  let starred = false;
  await page.route("**/api/v1/auth/session", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          userId: "operator-1",
          email: "operator@example.com",
          permissions: ["message.read"],
        },
      }),
    });
  });
  await page.route("**/api/v1/mailboxes", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: [
          {
            id: mailboxId,
            address: "ops@example.com",
            display_name: "Operations",
            status: "active",
            domain_id: "22222222-2222-4222-8222-222222222222",
            role: "owner",
          },
        ],
      }),
    });
  });
  await page.route(
    `**/api/v1/mailboxes/${mailboxId}/messages**`,
    async (route) => {
      const cursor = new URL(route.request().url()).searchParams.get("cursor");
      if (cursor === "next-page") paginationRequests += 1;
      else initialPageRequests += 1;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            items: [
              {
                id: "55555555-5555-4555-8555-555555555555",
                from_address: "sender@example.net",
                from_name: "Sender",
                subject: "Status update",
                status: "received",
                created_at: "2026-07-27 09:00:00",
                is_read: 0,
                is_starred: 0,
              },
            ],
            // Starring invalidates and refetches the initial query. The mock
            // must keep that page paginatable; only a cursor request is page 2.
            nextCursor: cursor === "next-page" ? null : "next-page",
          },
        }),
      });
    },
  );
  await page.route("**/api/v1/messages/*/star", async (route) => {
    starred = true;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ data: { updated: true } }),
    });
  });

  await page.goto(`/inbox/${mailboxId}`);

  await expect(page.getByText("Status update")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: uiLocale.copy.inbox }),
  ).toBeVisible();
  await expect.poll(() => initialPageRequests).toBe(1);
  await page.getByRole("button", { name: uiLocale.copy.star }).click();
  await expect.poll(() => starred).toBe(true);
  await page.getByRole("button", { name: uiLocale.copy.loadMore }).click();
  await expect.poll(() => paginationRequests).toBe(1);
  await page.getByRole("link", { name: uiLocale.copy.sent }).click();
  await expect(page).toHaveURL(/\/sent/u);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".mobile-menu").click();
  await expect(page.locator(".mail-sidebar")).toHaveClass(/open/u);
});
