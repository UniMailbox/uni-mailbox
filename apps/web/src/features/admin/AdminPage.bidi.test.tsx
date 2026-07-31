import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import { createTestI18n } from "../../i18n/test-instance";
import { AdminPage } from "./AdminPage";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to: _to, ...props }: React.PropsWithChildren<{ to: string }>) => <a {...props}>{children}</a>,
}));

describe("AdminPage bidi inputs", () => {
  it("keeps generic technical fields LTR without forcing display names LTR", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(["auth", "session"], { user: { id: "1", email: "admin@example.com" }, permissions: ["user.read", "user.manage"] });
    const { container } = render(<I18nextProvider i18n={createTestI18n("ar-XB")}><QueryClientProvider client={client}><AdminPage resource="users" /></QueryClientProvider></I18nextProvider>);

    expect(document.documentElement).toHaveAttribute("dir", "rtl");
    expect(container.querySelector("input#email")).toHaveAttribute("dir", "ltr");
    expect(container.querySelector("input#roleIds")).toHaveAttribute("dir", "ltr");
    expect(container.querySelector("input#displayName")).not.toHaveAttribute("dir");
  });
});
