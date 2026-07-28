import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

function renderApp() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  );
}

describe("UniMailbox application boundary", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("renders the secure operator login route", async () => {
    window.history.replaceState({}, "", "/login");
    renderApp();

    expect(
      await screen.findByRole("heading", {
        name: "Sign in to your mail plane.",
      }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Email address")).toHaveAttribute(
      "autocomplete",
      "email",
    );
    expect(
      screen.getByRole("button", { name: /Enter workspace/ }),
    ).toBeVisible();
  });

  it("redirects the removed setup route to login", async () => {
    window.history.replaceState({}, "", "/setup");
    renderApp();

    await waitFor(() => expect(window.location.pathname).toBe("/login"));
    expect(
      await screen.findByRole("heading", {
        name: "Sign in to your mail plane.",
      }),
    ).toBeVisible();
    expect(screen.queryByText(/installation token/i)).not.toBeInTheDocument();
  });
});
