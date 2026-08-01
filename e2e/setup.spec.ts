import { expect, test } from "@playwright/test";
import { adminSession, memberSession } from "./fixtures/session";

const anonymousSession = {
  error: {
    code: "AUTH_REQUIRED",
    message: "Authentication is required",
    requestId: "test",
  },
};

test("legacy setup route sends the operator to login", async ({ page }) => {
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify(anonymousSession),
    }),
  );
  await page.goto("/setup");

  await expect(
    page.getByRole("heading", { name: "Sign in to your mail plane." }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/login$/u);
  await expect(page.getByText(/installation token/i)).toHaveCount(0);
});

test("login route exposes an accessible credential form", async ({ page }) => {
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify(anonymousSession),
    }),
  );
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

test("compose uploads an attachment, saves a server draft, and sends it", async ({
  page,
}) => {
  const mailboxId = "11111111-1111-4111-8111-111111111111";
  const draftId = "22222222-2222-4222-8222-222222222222";
  let draftVersion = "2026-07-27 01:00:00";
  let sent = false;
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === "/api/v1/auth/session") {
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ data: memberSession() }),
      });
    }
    if (path === "/api/v1/mailboxes") {
      return route.fulfill({
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
    }
    if (path.includes("/messages")) {
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ data: { items: [], nextCursor: null } }),
      });
    }
    if (path === "/api/v1/attachments/uploads") {
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            attachmentId: "33333333-3333-4333-8333-333333333333",
            uploadUrl: "/test-upload",
            uploadHeaders: {},
          },
        }),
      });
    }
    if (path.endsWith("/complete")) {
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ data: { status: "uploaded" } }),
      });
    }
    if (path === "/api/v1/drafts" && route.request().method() === "POST") {
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            id: draftId,
            mailboxId,
            subject: "Incident update",
            html_body: "<p>Systems nominal</p>",
            text_body: "Systems nominal",
            updated_at: draftVersion,
            recipients: [{ type: "to", address: "team@example.com" }],
            attachments: [{ id: "33333333-3333-4333-8333-333333333333" }],
          },
        }),
      });
    }
    if (path === `/api/v1/drafts/${draftId}`) {
      draftVersion = "2026-07-27 01:01:00";
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            id: draftId,
            mailboxId,
            subject: "Incident update",
            html_body: "<p>Systems nominal</p>",
            text_body: "Systems nominal",
            updated_at: draftVersion,
            recipients: [{ type: "to", address: "team@example.com" }],
            attachments: [{ id: "33333333-3333-4333-8333-333333333333" }],
          },
        }),
      });
    }
    if (path === `/api/v1/drafts/${draftId}/send`) {
      sent = true;
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: { messageId: draftId, status: "queued" },
        }),
      });
    }
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ data: {} }),
    });
  });
  await page.route("**/test-upload", (route) =>
    route.fulfill({ status: 200, body: "" }),
  );

  await page.goto(`/inbox/${mailboxId}`);
  await page.getByRole("button", { name: "Compose" }).click();
  await page.getByLabel("To").fill("team@example.com");
  await page.getByLabel("Subject").fill("Incident update");
  await page.locator(".ProseMirror").fill("Systems nominal");
  await page.getByLabel("Attach file").setInputFiles({
    name: "runbook.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("recovery steps"),
  });
  await expect(page.getByText("1 attachment(s) ready")).toBeVisible();
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Saved to server")).toBeVisible();
  await page.getByRole("button", { name: "Send message" }).click();
  await expect.poll(() => sent).toBe(true);
  await expect(
    page.getByRole("complementary", { name: "Compose message" }),
  ).toBeHidden();
});

test("reply opens a threaded composer with quoted content", async ({
  page,
}) => {
  const mailboxId = "11111111-1111-4111-8111-111111111111";
  const messageId = "44444444-4444-4444-8444-444444444444";
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const data =
      path === "/api/v1/auth/session"
        ? memberSession()
        : path === `/api/v1/messages/${messageId}`
          ? {
              id: messageId,
              mailboxId,
              from_address: "sender@example.net",
              subject: "Change window",
              html_body: "<p>Proceed at 02:00 UTC.</p>",
              text_body: "Proceed at 02:00 UTC.",
              recipients: [{ type: "to", address: "ops@example.com" }],
            }
          : path.endsWith("/attachments")
            ? []
            : path === "/api/v1/mailboxes"
              ? [
                  {
                    id: mailboxId,
                    address: "ops@example.com",
                    display_name: "Operations",
                  },
                ]
              : { items: [], nextCursor: null };
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ data }),
    });
  });

  await page.goto(`/messages/${messageId}`);
  await page.getByRole("button", { name: "Reply" }).click();
  await expect(page.getByLabel("To", { exact: true })).toHaveValue(
    "sender@example.net",
  );
  await expect(page.getByLabel("Subject")).toHaveValue("Re: Change window");
  await expect(page.locator(".ProseMirror blockquote")).toContainText(
    "Proceed at 02:00 UTC.",
  );
});

test("mailbox sharing assigns an object-level role", async ({ page }) => {
  const mailboxId = "11111111-1111-4111-8111-111111111111";
  let sharedRole = "";
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/v1/auth/session") {
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ data: adminSession() }),
      });
    }
    if (path === "/api/v1/mailboxes") {
      return route.fulfill({
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
    }
    if (
      path === `/api/v1/mailboxes/${mailboxId}/members` &&
      request.method() === "POST"
    ) {
      sharedRole = (request.postDataJSON() as { role: string }).role;
    }
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ data: [] }),
    });
  });

  await page.goto("/settings/mailboxes");
  await page.getByText("Manage sharing").click();
  await page
    .getByLabel("Member user ID")
    .fill("55555555-5555-4555-8555-555555555555");
  await page.getByLabel("Mailbox role").selectOption("sender");
  await page.getByRole("button", { name: "Share mailbox" }).click();
  await expect.poll(() => sharedRole).toBe("sender");
});
