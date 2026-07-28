import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InstallationStep } from "@unimailbox/contracts";
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

  it("renders server-owned installation progress and claims setup", async () => {
    window.history.replaceState({}, "", "/setup");
    const fetchMock = vi
      .spyOn(window, "fetch")
      .mockResolvedValueOnce(
        Response.json({
          data: {
            installationVersion: 1,
            stateVersion: 0,
            currentStep: InstallationStep.CLAIM,
            completedSteps: [],
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          data: {
            csrfToken: "csrf-token",
            expiresAt: "2099-01-01T00:00:00.000Z",
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          data: {
            installationVersion: 1,
            stateVersion: 1,
            currentStep: InstallationStep.PREFLIGHT,
            completedSteps: [InstallationStep.CLAIM],
          },
        }),
      );
    renderApp();

    expect(
      await screen.findByRole("heading", {
        name: "Bring your mail plane online.",
      }),
    ).toBeVisible();
    fireEvent.change(screen.getByLabelText("Installation token"), {
      target: { value: "x".repeat(32) },
    });
    fireEvent.click(screen.getByRole("button", { name: "Claim installation" }));

    await waitFor(() =>
      expect(window.sessionStorage.getItem("unimailbox.setup-csrf")).toBe(
        "csrf-token",
      ),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/setup/claim",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
