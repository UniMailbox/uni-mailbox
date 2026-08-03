import { expect, test } from "./fixtures/locale";
import { sessionProfile } from "./fixtures/session";

const messageId = "44444444-4444-4444-8444-444444444444";
const domainId = "55555555-5555-4555-8555-555555555555";
const mailboxId = "66666666-6666-4666-8666-666666666666";

test("global message access is visible, read-only, and sanitized", async ({
  page,
  uiLocale,
}) => {
  const labels =
    uiLocale.code === "zh-CN"
      ? {
          heading: "所有邮件",
          users: "用户",
          view: "查看邮件：Private subject",
          content: "邮件内容",
          notice: "这是全局只读视图。打开邮件详情会记录到审计日志。",
        }
      : {
          heading: "All messages",
          users: "Users",
          view: "View message: Private subject",
          content: "Message content",
          notice:
            "This is a read-only global view. Opening a message is recorded in the audit trail.",
        };
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/v1/auth/session") {
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: sessionProfile(["message.read_all"]),
        }),
      });
    }
    if (path === `/api/v1/admin/messages/${messageId}`) {
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            id: messageId,
            domain_id: domainId,
            domain_name: "private.example.com",
            thread_id: null,
            from_address: "sender@example.net",
            from_name: "Sender",
            subject: "Private subject",
            html_body: "<p>Private body</p><script>alert(1)</script>",
            text_body: "Private body",
            message_id_header: null,
            in_reply_to_header: null,
            references_header: "",
            provider_key: null,
            provider_message_id: null,
            status: "received",
            created_at: "2026-08-02 12:00:00",
            updated_at: "2026-08-02 12:00:00",
            sent_at: null,
            received_at: "2026-08-02 12:00:00",
            recipients: [
              {
                type: "to",
                address: "private@private.example.com",
                display_name: null,
              },
            ],
            mailboxes: [
              {
                id: mailboxId,
                address: "private@private.example.com",
                folder: "inbox",
              },
            ],
            attachments: [],
          },
        }),
      });
    }
    if (path === "/api/v1/admin/messages") {
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            items: [
              {
                id: messageId,
                domain_id: domainId,
                domain_name: "private.example.com",
                from_address: "sender@example.net",
                from_name: "Sender",
                subject: "Private subject",
                status: "received",
                recipient_addresses: "private@private.example.com",
                mailbox_addresses: "private@private.example.com",
                created_at: "2026-08-02 12:00:00",
                sent_at: null,
                received_at: "2026-08-02 12:00:00",
              },
            ],
            nextCursor: null,
          },
        }),
      });
    }
    return route.abort();
  });

  await page.goto("/admin/messages");
  await expect(
    page.getByRole("heading", { name: labels.heading }),
  ).toBeVisible();
  await expect(page.getByText(labels.notice)).toBeVisible();
  await expect(page.getByRole("link", { name: labels.users })).toHaveCount(0);
  await page.getByRole("button", { name: labels.view }).click();

  const frame = page.getByTitle(labels.content);
  await expect(frame).toHaveAttribute("sandbox", "");
  const source = await frame.getAttribute("srcdoc");
  expect(source).toContain("<p>Private body</p>");
  expect(source).not.toContain("<script>");
});

test("mailbox-scoped message.read cannot open the global message page", async ({
  page,
  uiLocale,
}) => {
  let globalMessageRequests = 0;
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/v1/auth/session") {
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ data: sessionProfile(["message.read"]) }),
      });
    }
    if (path.startsWith("/api/v1/admin/messages")) globalMessageRequests += 1;
    return route.abort();
  });

  await page.goto("/admin/messages");
  await expect(
    page.getByText(
      uiLocale.code === "zh-CN"
        ? "您无权访问此区域"
        : "You do not have access to this area",
    ),
  ).toBeVisible();
  expect(globalMessageRequests).toBe(0);
});
