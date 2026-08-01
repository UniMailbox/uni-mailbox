import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import { createTestQueryClient } from "../../app/query-client";
import { createAppRouter } from "../../app/router";
import { createI18nInstance } from "../../i18n";
import en from "../../i18n/resources/en/admin.json";
import zhCN from "../../i18n/resources/zh-CN/admin.json";
import arXB from "../../i18n/resources/ar-XB/admin.json";
import { CreateDomainPanel } from "./AdminPage";

type TranslationTree = string | { [key: string]: TranslationTree };

function leaves(value: TranslationTree, prefix = ""): string[] {
  if (!value || typeof value !== "object") return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    leaves(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe("Administration", () => {
  it("keeps English, Chinese, and pseudo-RTL administration keys aligned", () => {
    expect(leaves(zhCN)).toEqual(leaves(en));
    expect(leaves(arXB)).toEqual(leaves(en));
  });

  it("renders localized navigation and does not expose raw Worker values", async () => {
    Object.defineProperty(window, "scrollTo", {
      value: vi.fn(),
      configurable: true,
    });
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(["auth", "session"], {
      user: {
        id: "11111111-1111-4111-8111-111111111111",
        email: "admin@example.com",
        displayName: "Admin",
      },
      permissions: ["user.read"],
    });
    const router = createAppRouter({ queryClient });
    const i18n = createI18nInstance("zh-CN");
    await router.navigate({ to: "/admin/users" });
    render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} context={{ queryClient }} />
        </QueryClientProvider>
      </I18nextProvider>,
    );
    expect(await screen.findByRole("heading", { name: "用户" })).toBeVisible();
    expect(screen.getByRole("link", { name: "返回邮件" })).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "创建" }),
    ).not.toBeInTheDocument();
  });

  it("defines localized labels for every Worker user and webhook status", () => {
    const statuses = [
      "active",
      "suspended",
      "deleted",
      "draft",
      "queued",
      "sending",
      "sent",
      "delayed",
      "delivered",
      "bounced",
      "failed",
      "complained",
      "received",
    ] as const;
    for (const status of statuses) {
      expect(en.values[status]).toBeTruthy();
      expect(zhCN.values[status]).toBeTruthy();
      expect(arXB.values[status]).toBeTruthy();
    }
  });

  it("shows Cloudflare Email Routing guidance after creating a domain", async () => {
    vi.spyOn(window, "fetch").mockResolvedValue(
      Response.json(
        {
          data: {
            id: "11111111-1111-4111-8111-111111111111",
            name: "mail.example.com",
            expectedRoute: "*@mail.example.com -> unimailbox Worker",
            routingConfiguration: {
              status: "manual_setup_required",
              dashboardUrl:
                "https://dash.cloudflare.com/?to=%2Faccount-1%2Femail-service%2Frouting",
            },
          },
        },
        { status: 201 },
      ),
    );
    render(
      <I18nextProvider i18n={createI18nInstance("en")}>
        <QueryClientProvider client={createTestQueryClient()}>
          <CreateDomainPanel />
        </QueryClientProvider>
      </I18nextProvider>,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
      target: { value: "mail.example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(
      await screen.findByRole("heading", {
        name: "Finish setup in Cloudflare",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Open Email Routing" }),
    ).toHaveAttribute(
      "href",
      "https://dash.cloudflare.com/?to=%2Faccount-1%2Femail-service%2Frouting",
    );
  });
});
