import { expect, test } from "./fixtures/locale";

const mailboxId = "11111111-1111-4111-8111-111111111111";
const messageId = "55555555-5555-4555-8555-555555555555";

test("message detail moves an item to archive", async ({ page, uiLocale }) => {
  let moved = false;
  await page.route("**/api/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/auth/session")) return route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: { userId: "operator-1", email: "operator@example.com", permissions: ["message.read"] } }) });
    if (path === `/api/v1/messages/${messageId}`) return route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: { id: messageId, mailboxId, from_address: "sender@example.net", subject: "Archive me", html_body: "<p>Message</p>", text_body: "Message", recipients: [] } }) });
    if (path.endsWith("/folder")) {
      moved = (route.request().postDataJSON() as { folder?: string }).folder === "archive";
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: { updated: true } }) });
    }
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: [] }) });
  });
  await page.goto(`/messages/${messageId}`);
  await page.getByRole("button", { name: uiLocale.copy.archive }).click();
  await expect.poll(() => moved).toBe(true);
  await expect(page).toHaveURL(new RegExp(`/archive/${mailboxId}$`, "u"));
});
