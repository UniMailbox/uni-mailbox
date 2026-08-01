import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import { createTestI18n } from "../../i18n/test-instance";
import { AdminPage } from "./AdminPage";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to: _to,
    ...props
  }: React.PropsWithChildren<{ to: string }>) => <a {...props}>{children}</a>,
}));

describe("AdminPage bidi inputs", () => {
  it("keeps generic technical fields LTR without forcing display names LTR", () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    client.setQueryData(["auth", "session"], {
      user: { id: "1", email: "admin@example.com" },
      permissions: ["user.read", "user.manage"],
    });
    const { container } = render(
      <I18nextProvider i18n={createTestI18n("ar-XB")}>
        <QueryClientProvider client={client}>
          <AdminPage resource="users" />
        </QueryClientProvider>
      </I18nextProvider>,
    );

    fireEvent.click(container.querySelector(".surface-actions button")!);

    expect(document.documentElement).toHaveAttribute("dir", "rtl");
    expect(container.querySelector("input#email")).toHaveAttribute(
      "dir",
      "ltr",
    );
    expect(container.querySelector("input#roleIds")).toHaveAttribute(
      "dir",
      "ltr",
    );
    expect(container.querySelector("input#displayName")).not.toHaveAttribute(
      "dir",
    );
  });

  it("keeps a domain hostname LTR without forcing a role name LTR", () => {
    const domainsClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    domainsClient.setQueryData(["auth", "session"], {
      user: { id: "1", email: "admin@example.com" },
      permissions: ["domain.read", "domain.manage"],
    });
    const domains = render(
      <I18nextProvider i18n={createTestI18n("ar-XB")}>
        <QueryClientProvider client={domainsClient}>
          <AdminPage resource="domains" />
        </QueryClientProvider>
      </I18nextProvider>,
    );
    fireEvent.click(
      domains.container.querySelector(".surface-actions button")!,
    );
    expect(domains.container.querySelector("input#name")).toHaveAttribute(
      "dir",
      "ltr",
    );

    const rolesClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    rolesClient.setQueryData(["auth", "session"], {
      user: { id: "1", email: "admin@example.com" },
      permissions: ["role.read", "role.manage"],
    });
    const roles = render(
      <I18nextProvider i18n={createTestI18n("ar-XB")}>
        <QueryClientProvider client={rolesClient}>
          <AdminPage resource="roles" />
        </QueryClientProvider>
      </I18nextProvider>,
    );
    fireEvent.click(roles.container.querySelector(".surface-actions button")!);
    expect(roles.container.querySelector("input#name")).not.toHaveAttribute(
      "dir",
    );
  });

  it("opens view, edit, and delete actions from the selected table row", () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    client.setQueryData(["auth", "session"], {
      user: { id: "1", email: "admin@example.com" },
      permissions: ["user.read", "user.manage"],
    });
    client.setQueryData(
      ["admin", "users"],
      [
        {
          id: "11111111-1111-4111-8111-111111111111",
          email: "lin@example.com",
          display_name: "Lin Qiao",
          status: "active",
          created_at: "2026-08-01 09:30:00",
          roles: "operator",
        },
      ],
    );
    const { container } = render(
      <I18nextProvider i18n={createTestI18n("en")}>
        <QueryClientProvider client={client}>
          <AdminPage resource="users" />
        </QueryClientProvider>
      </I18nextProvider>,
    );

    expect(screen.getByRole("columnheader", { name: "Actions" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "View" }));
    expect(
      screen.getByRole("dialog", { name: "View Users record" }),
    ).toHaveTextContent("lin@example.com");
    fireEvent.click(screen.getAllByRole("button", { name: "Close" })[0]);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("textbox", { name: "Display name" })).toHaveValue(
      "Lin Qiao",
    );
    expect(
      screen.queryByRole("textbox", { name: "Record ID" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(
      screen.getByRole("dialog", { name: "Delete Users record" }),
    ).toHaveTextContent("lin@example.com");
    expect(container.querySelectorAll(".create-panel")).toHaveLength(0);
  });
});
