import { expect, test } from "./fixtures/locale";

test("project locale initializes per context and preserves user choice after reload", async ({
  page,
  uiLocale,
}) => {
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          userId: "operator-1",
          email: "operator@example.com",
          permissions: ["settings.manage"],
        },
      }),
    }),
  );

  const secondPage = await page.context().newPage();
  await secondPage.goto("/login");
  await expect(secondPage.locator("html")).toHaveAttribute(
    "lang",
    uiLocale.code,
  );
  await secondPage.close();

  await page.goto("/settings/preferences");

  await expect(page.locator("html")).toHaveAttribute("lang", uiLocale.code);
  await expect(
    page.getByRole("region", { name: uiLocale.copy.settings }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: uiLocale.copy.preferences }),
  ).toBeVisible();
  await page.getByLabel(uiLocale.copy.timeZone).selectOption("Asia/Singapore");
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("unimailbox.time-zone")),
    )
    .toBe("Asia/Singapore");
  await page.getByLabel(uiLocale.copy.themeColor).fill("#2563eb");
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("unimailbox.theme-color")),
    )
    .toBe("#2563eb");
  await expect
    .poll(() =>
      page.evaluate(() =>
        document.documentElement.style.getPropertyValue("--theme-color"),
      ),
    )
    .toBe("#2563eb");
  await page
    .getByLabel(uiLocale.copy.language)
    .selectOption(uiLocale.code === "en" ? "zh-CN" : "en");
  const expected = uiLocale.code === "en" ? "zh-CN" : "en";
  await expect(page.locator("html")).toHaveAttribute("lang", expected);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", expected);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("unimailbox.locale")))
    .toBe(expected);
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("unimailbox.time-zone")),
    )
    .toBe("Asia/Singapore");
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("unimailbox.theme-color")),
    )
    .toBe("#2563eb");
  await expect
    .poll(() =>
      page.evaluate(() =>
        document.documentElement.style.getPropertyValue("--theme-color"),
      ),
    )
    .toBe("#2563eb");
});

test("message timestamps use the selected time zone", async ({
  page,
  uiLocale,
}) => {
  const messageId = "44444444-4444-4444-8444-444444444444";
  await page.route("**/api/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const data =
      path === "/api/v1/auth/session"
        ? {
            userId: "operator-1",
            email: "operator@example.com",
            permissions: ["message.read"],
          }
        : path === `/api/v1/messages/${messageId}`
          ? {
              id: messageId,
              thread_id: null,
              mailboxMessageId: messageId,
              mailboxId: "11111111-1111-4111-8111-111111111111",
              from_address: "sender@example.net",
              from_name: "Sender",
              subject: "Time-zone check",
              html_body: "<p>Body</p>",
              text_body: "Body",
              message_id_header: null,
              in_reply_to_header: null,
              references_header: "",
              status: "received",
              created_at: "2026-07-31T23:30:00.000Z",
              updated_at: "2026-07-31T23:30:00.000Z",
              sent_at: null,
              received_at: "2026-07-31T23:30:00.000Z",
              recipients: [{ type: "to", address: "ops@example.com" }],
            }
          : [];
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ data }),
    });
  });

  await page.goto("/settings/preferences");
  await page.getByLabel(uiLocale.copy.timeZone).selectOption("Asia/Singapore");
  await page.goto(`/messages/${messageId}`);

  const timestamp = page.getByTestId("message-timestamp");
  await expect(timestamp).toContainText(/(?:7:30 AM|07:30)/u);
  await expect(timestamp).toContainText(
    uiLocale.code === "zh-CN" ? "2026年8月1日" : "Aug 1, 2026",
  );
});

test("authorized administration uses localized navigation", async ({
  page,
  uiLocale,
}) => {
  let created = false;
  let updated = false;
  let deleted = false;
  let mailboxGranted = false;
  let mailboxRemoved = false;
  const existingUserId = "22222222-2222-4222-8222-222222222222";
  const roleId = "11111111-1111-4111-8111-111111111111";
  const mailboxId = "33333333-3333-4333-8333-333333333333";
  const domainId = "44444444-4444-4444-8444-444444444444";
  await page.route("**/api/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/auth/session")) {
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            userId: "operator-1",
            email: "operator@example.com",
            permissions: ["user.read", "user.manage"],
          },
        }),
      });
    }
    if (path.endsWith("/admin/users") && route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      created = Array.isArray(body.roleIds) && body.roleIds[0] === roleId;
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            id: "11111111-1111-4111-8111-111111111111",
            email: "operator@example.com",
          },
        }),
      });
    }
    if (path.endsWith("/admin/users/role-options")) {
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: [{ id: roleId, name: "Administrators", is_system: 1 }],
        }),
      });
    }
    if (
      path.endsWith(`/admin/users/${existingUserId}/mailboxes/${mailboxId}`) &&
      route.request().method() === "DELETE"
    ) {
      mailboxGranted = false;
      mailboxRemoved = true;
      return route.fulfill({ status: 204 });
    }
    if (
      path.endsWith(`/admin/users/${existingUserId}/mailboxes`) &&
      route.request().method() === "POST"
    ) {
      const body = route.request().postDataJSON();
      mailboxGranted = body.mailboxId === mailboxId && body.role === "sender";
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            mailboxId,
            address: "team@example.com",
            displayName: "Team",
            status: "active",
            domainId,
            role: "sender",
            ownerUserId: "55555555-5555-4555-8555-555555555555",
            ownerEmail: "owner@example.com",
            ownerDisplayName: "Owner",
          },
        }),
      });
    }
    if (path.endsWith(`/admin/users/${existingUserId}/mailboxes`)) {
      const mailbox = {
        mailboxId,
        address: "team@example.com",
        displayName: "Team",
        status: "active" as const,
        ownerEmail: "owner@example.com",
      };
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            items: mailboxGranted
              ? [
                  {
                    ...mailbox,
                    domainId,
                    role: "sender",
                    ownerUserId: "55555555-5555-4555-8555-555555555555",
                    ownerDisplayName: "Owner",
                  },
                ]
              : [],
            available: mailboxGranted ? [] : [mailbox],
          },
        }),
      });
    }
    if (
      path.endsWith(`/admin/users/${existingUserId}`) &&
      route.request().method() === "PATCH"
    ) {
      updated = true;
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: { id: existingUserId, displayName: "Operator Updated" },
        }),
      });
    }
    if (
      path.endsWith(`/admin/users/${existingUserId}`) &&
      route.request().method() === "DELETE"
    ) {
      deleted = true;
      return route.fulfill({ status: 204 });
    }
    if (path.endsWith("/admin/users")) {
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: [
            {
              id: existingUserId,
              email: "lin@example.com",
              display_name: "Lin Qiao",
              status: "active",
              created_at: "2026-08-01 09:30:00",
              roles: "operator",
              role_ids: roleId,
            },
          ],
        }),
      });
    }
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ data: [] }),
    });
  });
  await page.goto("/admin/users");
  await expect(
    page.getByRole("heading", { name: uiLocale.copy.users }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: uiLocale.copy.administration }),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: uiLocale.copy.recordId }),
  ).toHaveCount(0);
  await expect(page.getByText(existingUserId)).toHaveCount(0);
  await page.getByRole("button", { name: uiLocale.copy.addUsers }).click();
  const createDialog = page.getByRole("dialog");
  await createDialog.getByLabel(uiLocale.copy.displayName).fill("Operator");
  await createDialog
    .getByLabel(uiLocale.copy.emailField)
    .fill("operator@example.com");
  await createDialog
    .getByLabel(uiLocale.copy.passwordField)
    .fill("correct horse battery staple");
  await createDialog
    .getByRole("combobox", { name: uiLocale.copy.assignedRoles })
    .click();
  await page.getByRole("option", { name: "Administrators" }).click();
  await expect(
    createDialog.getByText(uiLocale.copy.assignedRoles),
  ).toBeVisible();
  await createDialog
    .getByRole("button", { name: uiLocale.copy.create })
    .click();
  await expect.poll(() => created).toBe(true);

  await page.getByRole("button", { name: uiLocale.copy.view }).click();
  const viewDialog = page.getByRole("dialog");
  await expect(viewDialog).toContainText("lin@example.com");
  await expect(
    viewDialog.getByRole("heading", { name: uiLocale.copy.mailboxAccess }),
  ).toBeVisible();
  await viewDialog
    .getByLabel(uiLocale.copy.mailboxAddress)
    .fill("team@example.com");
  await viewDialog.getByLabel(uiLocale.copy.accessRole).selectOption("sender");
  await viewDialog
    .getByRole("button", { name: uiLocale.copy.grantMailboxAccess })
    .click();
  await expect.poll(() => mailboxGranted).toBe(true);
  await expect(viewDialog.getByText("team@example.com")).toBeVisible();
  await viewDialog.getByRole("button", { name: uiLocale.copy.remove }).click();
  await expect.poll(() => mailboxRemoved).toBe(true);
  await page.getByRole("button", { name: uiLocale.copy.close }).first().click();

  await page.getByRole("button", { name: uiLocale.copy.edit }).click();
  await page
    .getByRole("dialog")
    .getByLabel(uiLocale.copy.displayName)
    .fill("Operator Updated");
  await page.getByRole("button", { name: uiLocale.copy.update }).click();
  await expect.poll(() => updated).toBe(true);

  await page.getByRole("button", { name: uiLocale.copy.delete }).click();
  await expect(page.getByRole("dialog")).toContainText("lin@example.com");
  await page.getByRole("button", { name: uiLocale.copy.deleteRecord }).click();
  await expect.poll(() => deleted).toBe(true);
});
