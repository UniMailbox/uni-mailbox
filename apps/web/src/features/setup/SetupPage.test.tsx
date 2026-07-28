import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InstallationStep } from "@unimailbox/contracts";
import { SetupPage } from "./SetupPage";

function renderSetup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <SetupPage />
    </QueryClientProvider>,
  );
}

describe("SetupPage", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("renders the loading state while status is being read", () => {
    vi.spyOn(window, "fetch").mockReturnValue(new Promise(() => undefined));
    renderSetup();
    expect(screen.getByText("Reading installation state")).toBeInTheDocument();
  });

  it("renders an error state when the status request fails", async () => {
    vi.spyOn(window, "fetch").mockResolvedValueOnce(
      Response.json(
        {
          error: {
            code: "BOOTSTRAP_FAILED",
            message: "Bootstrap failed",
            requestId: "req-1",
          },
        },
        { status: 500 },
      ),
    );
    renderSetup();
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Bootstrap failed"),
    );
  });

  it("lists the installation steps with progress and shows the current action", async () => {
    const fetchMock = vi.spyOn(window, "fetch").mockResolvedValueOnce(
      Response.json({
        data: {
          installationVersion: 1,
          stateVersion: 2,
          currentStep: InstallationStep.ADMIN,
          completedSteps: [
            InstallationStep.CLAIM,
            InstallationStep.PREFLIGHT,
          ],
        },
      }),
    );
    renderSetup();

    expect(
      await screen.findByRole("heading", {
        name: "Bring your mail plane online.",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      "Create administrator",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/setup/status",
      expect.anything(),
    );
    expect(screen.getByText("Display name")).toBeInTheDocument();
  });

  it("renders the setup page once status resolves", async () => {
    vi.spyOn(window, "fetch").mockResolvedValueOnce(
      Response.json({
        data: {
          installationVersion: 1,
          stateVersion: 1,
          currentStep: InstallationStep.COMPLETE,
          completedSteps: [
            InstallationStep.CLAIM,
            InstallationStep.PREFLIGHT,
            InstallationStep.ADMIN,
            InstallationStep.CLOUDFLARE,
            InstallationStep.DOMAIN,
            InstallationStep.INBOUND_SMOKE_TEST,
            InstallationStep.BREVO,
            InstallationStep.OUTBOUND_SMOKE_TEST,
          ],
        },
      }),
    );
    renderSetup();

    expect(
      await screen.findByRole("heading", {
        name: "Bring your mail plane online.",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      "Finish installation",
    );
  });
});