import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setAccessToken } from "../../lib/api";
import { SettingsPage } from "./SettingsPage";

function renderSettings(
  section: "account" | "mailboxes" | "cloudflare" | "storage",
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <SettingsPage section={section} />
    </QueryClientProvider>,
  );
}

describe("authenticated settings", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/settings");
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("changes only the login email and returns to login", async () => {
    setAccessToken("access-token");
    const fetchMock = vi.spyOn(window, "fetch").mockResolvedValue(
      Response.json({
        data: {
          email: "new.login@example.com",
          sessionsRevoked: true,
        },
      }),
    );
    renderSettings("account");

    fireEvent.change(screen.getByLabelText("New login email"), {
      target: { value: "new.login@example.com" },
    });
    fireEvent.change(
      screen.getAllByLabelText("Current password", {
        selector: "input",
      })[0] as HTMLInputElement,
      { target: { value: "current-password-1234" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Update login email" }));

    await waitFor(() => expect(window.location.pathname).toBe("/login"));
    expect(window.sessionStorage.getItem("unimailbox.access-token")).toBeNull();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/v1/auth/email");
    expect(init).toMatchObject({ method: "POST" });
    expect(JSON.parse(String(init?.body))).toEqual({
      currentPassword: "current-password-1234",
      email: "new.login@example.com",
    });
    expect(
      screen.getByText(/does not create, select, or modify a mailbox/i),
    ).toBeVisible();
  });

  it("shows required services and keeps R2 verification disabled on KV", async () => {
    vi.spyOn(window, "fetch").mockResolvedValue(
      Response.json({
        data: {
          required: {
            d1: "ok",
            kv: "ok",
            queue: "ok",
            assets: "ok",
          },
          attachments: {
            backend: "kv",
            r2: "missing",
            reason:
              "ATTACHMENTS binding is absent; KV is the default storage backend",
          },
        },
      }),
    );
    renderSettings("storage");

    expect(await screen.findByText("KV storage is active")).toBeVisible();
    expect(screen.getByText("KV healthy")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Verify R2 write access" }),
    ).toBeDisabled();
    for (const resource of ["D1", "KV", "QUEUE", "ASSETS"]) {
      expect(screen.getByText(resource)).toBeVisible();
    }
  });

  it("renders independent Cloudflare configuration cards", async () => {
    vi.spyOn(window, "fetch").mockResolvedValue(
      Response.json({
        data: [
          {
            checkpointKey: "cloudflare_mail",
            status: "failed",
            metadata: {},
            errorCode: "CLOUDFLARE_API_FAILED",
            errorMessage: "Retry Cloudflare verification",
            verifiedAt: null,
          },
          {
            checkpointKey: "brevo",
            status: "pending",
            metadata: {},
            errorCode: null,
            errorMessage: null,
            verifiedAt: null,
          },
        ],
      }),
    );
    renderSettings("cloudflare");

    expect(await screen.findByText("Connect the control plane")).toBeVisible();
    expect(screen.getByText("Email Routing domain")).toBeVisible();
    expect(screen.getByText("Inbound smoke test")).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Connect Brevo" }),
    ).toBeVisible();
    expect(screen.getByText("Outbound smoke test")).toBeVisible();
    expect(screen.getByText("Action required")).toBeVisible();
  });
});
