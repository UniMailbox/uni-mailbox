import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type * as ReactRouter from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import { createTestI18n } from "../../i18n/test-instance";
import { LoginPage } from "./LoginPage";

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof ReactRouter>()),
  Link: ({
    children,
    to: _to,
    ...props
  }: React.PropsWithChildren<{ to: string }>) => <a {...props}>{children}</a>,
  useNavigate: () => vi.fn(),
  useSearch: () => ({}),
}));

describe("LoginPage bidi inputs", () => {
  it("keeps the login email LTR in the pseudo-RTL locale", () => {
    render(
      <I18nextProvider i18n={createTestI18n("ar-XB")}>
        <QueryClientProvider
          client={
            new QueryClient({ defaultOptions: { mutations: { retry: false } } })
          }
        >
          <LoginPage />
        </QueryClientProvider>
      </I18nextProvider>,
    );

    expect(document.documentElement).toHaveAttribute("dir", "rtl");
    expect(screen.getByRole("textbox")).toHaveAttribute("dir", "ltr");
  });
});
