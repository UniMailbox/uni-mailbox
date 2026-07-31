import { expect, test } from "./fixtures/locale";
import { mailboxId, messageDetailFixture, messageId } from "./fixtures/message-detail";

test("message detail moves an item to archive", async ({ page, uiLocale }) => {
  let moved = false;
  await page.route("**/api/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/auth/session")) return route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: { userId: "operator-1", email: "operator@example.com", permissions: ["message.read"] } }) });
    if (path === `/api/v1/messages/${messageId}`) return route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: messageDetailFixture }) });
    if (path.endsWith("/folder")) {
      moved = (route.request().postDataJSON() as { folder?: string }).folder === "archive";
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: { updated: true, folder: "archive" } }) });
    }
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: [] }) });
  });
  await page.goto(`/messages/${messageId}`);
  await page.getByRole("button", { name: uiLocale.copy.archive }).click();
  await expect.poll(() => moved).toBe(true);
  await expect(page).toHaveURL(new RegExp(`/archive/${mailboxId}$`, "u"));
});
