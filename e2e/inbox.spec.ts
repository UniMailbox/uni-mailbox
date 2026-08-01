import { expect, test } from "@playwright/test";
import { memberSession } from "./fixtures/session";

const mailboxId = "11111111-1111-4111-8111-111111111111";

test("mailbox route loads messages and toggles the sidebar", async ({
  page,
}) => {
  await page.route("**/api/v1/auth/session", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ data: memberSession() }),
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
          },
        ],
      }),
    });
  });
  await page.route(
    `**/api/v1/mailboxes/${mailboxId}/messages**`,
    async (route) => {
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
            nextCursor: null,
          },
        }),
      });
    },
  );

  await page.goto(`/inbox/${mailboxId}`);

  await expect(page.getByText("Status update")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
});
