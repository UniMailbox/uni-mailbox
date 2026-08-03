import { expect, test } from "./fixtures/locale";
import { sessionProfile } from "./fixtures/session";

const attachmentId = "44444444-4444-4444-8444-444444444444";
const messageId = "55555555-5555-4555-8555-555555555555";

test("mailbox attachment catalog searches and previews protected bytes", async ({
  page,
  uiLocale,
}) => {
  const labels =
    uiLocale.code === "zh-CN"
      ? {
          heading: "附件库",
          search: "搜索附件",
          action: "搜索",
          view: "查看",
          dialog: "查看附件",
          download: "下载",
        }
      : {
          heading: "Attachments",
          search: "Search attachments",
          action: "Search",
          view: "View",
          dialog: "View attachment",
          download: "Download",
        };
  let requestedSearch = "";
  let downloadRequests = 0;
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/v1/auth/session") {
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: sessionProfile(["message.read", "attachment.read"]),
        }),
      });
    }
    if (url.pathname === "/api/v1/admin/attachments") {
      requestedSearch = url.searchParams.get("q") ?? "";
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            items: [
              {
                id: attachmentId,
                message_id: messageId,
                filename: "report.png",
                mime_type: "image/png",
                size_bytes: 68,
                disposition: "attachment",
                content_id: null,
                md5: "8d777f385d3dfec8815d20f7496026dc",
                subject: "Quarterly report",
                from_address: "sender@example.net",
                message_created_at: "2026-08-02 12:00:00",
                created_at: "2026-08-02 12:00:00",
                reference_count: 2,
              },
            ],
            nextCursor: null,
          },
        }),
      });
    }
    if (url.pathname === `/api/v1/admin/attachments/${attachmentId}/download`) {
      downloadRequests += 1;
      return route.fulfill({
        contentType: "image/png",
        headers: {
          "content-disposition": "attachment; filename=report.png",
        },
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2S1cAAAAASUVORK5CYII=",
          "base64",
        ),
      });
    }
    return route.abort();
  });

  await page.goto("/admin/attachments");
  await expect(
    page.getByRole("heading", { name: labels.heading }),
  ).toBeVisible();
  await page.getByLabel(labels.search).fill("8d777f");
  await page.getByRole("button", { name: labels.action }).click();
  await expect(page.getByText("report.png")).toBeVisible();
  await page.getByRole("button", { name: labels.view }).click();

  await expect(page.getByRole("dialog")).toContainText(labels.dialog);
  await expect(page.getByAltText("report.png")).toHaveAttribute(
    "src",
    /^blob:/u,
  );
  await expect(
    page.getByRole("link", { name: labels.download }),
  ).toHaveAttribute("download", "report.png");
  expect(requestedSearch).toBe("8d777f");
  expect(downloadRequests).toBe(1);
});
