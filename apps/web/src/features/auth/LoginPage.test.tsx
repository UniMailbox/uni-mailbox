import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type * as ReactRouter from "@tanstack/react-router";
import { fireEvent, render, screen } from "@testing-library/react";
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

function renderLogin(locale: "en" | "ar-XB") {
  return render(
    <I18nextProvider i18n={createTestI18n(locale)}>
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { mutations: { retry: false } } })
        }
      >
        <LoginPage />
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

describe("LoginPage bidi inputs", () => {
  it("keeps the login email LTR in the pseudo-RTL locale", () => {
    renderLogin("ar-XB");

    expect(document.documentElement).toHaveAttribute("dir", "rtl");
    expect(screen.getByRole("textbox")).toHaveAttribute("dir", "ltr");
  });

  it("shows schema feedback when native email validation would reject submit", async () => {
    const fetchMock = vi.spyOn(window, "fetch");
    renderLogin("en");
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "not-an-email" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "long-enough-password" },
    });
    const submit = screen.getByRole("button", { name: "Enter workspace" });

    fireEvent.click(submit);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "valid Email address",
    );
    expect(submit).toBeEnabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("LoginPage password visibility", () => {
  it("defaults to type=password and offers a localized toggle", () => {
    renderLogin("en");

    const input = screen.getByLabelText("Password");
    const toggle = screen.getByRole("button", { name: "Show password" });

    expect(input).toHaveAttribute("type", "password");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  it("switches between type=password and type=text when toggled", () => {
    renderLogin("en");

    const input = screen.getByLabelText("Password");

    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(input).toHaveAttribute("type", "text");
    expect(
      screen.getByRole("button", { name: "Hide password" }),
    ).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Hide password" }));
    expect(input).toHaveAttribute("type", "password");
    expect(
      screen.getByRole("button", { name: "Show password" }),
    ).toHaveAttribute("aria-pressed", "false");
  });
});
