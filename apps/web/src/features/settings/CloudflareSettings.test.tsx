import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import { createI18nInstance } from "../../i18n";
import { createTestI18n } from "../../i18n/test-instance";
import { CloudflareSettings, followCloudflareOauth } from "./CloudflareSettings";

describe("CloudflareSettings", () => {
  it("maps checkpoint states to localized product copy instead of provider diagnostics", async () => {
    vi.spyOn(window, "fetch").mockResolvedValue(Response.json({ data: [{ checkpointKey: "cloudflare_mail", status: "failed", metadata: {}, errorCode: "CLOUDFLARE_API_FAILED", errorMessage: "provider-only diagnostic", verifiedAt: null }] }));
    render(<I18nextProvider i18n={createI18nInstance("en")}><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><CloudflareSettings /></QueryClientProvider></I18nextProvider>);
    expect(await screen.findByText("Connect the control plane")).toBeVisible();
    expect(screen.getByText("Action required")).toBeVisible();
    expect(screen.queryByText("provider-only diagnostic")).not.toBeInTheDocument();
  });

  it("leaves the app for the Worker-provided OAuth URL", () => {
    const location = { assign: vi.fn() };
    followCloudflareOauth("https://dash.cloudflare.com/oauth2/auth?state=worker-state", location);
    expect(location.assign).toHaveBeenCalledWith("https://dash.cloudflare.com/oauth2/auth?state=worker-state");
  });

  it("keeps technical configuration inputs LTR in the pseudo-RTL locale", async () => {
    vi.spyOn(window, "fetch").mockResolvedValue(Response.json({ data: [] }));
    const { container } = render(<I18nextProvider i18n={createTestI18n("ar-XB")}><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><CloudflareSettings /></QueryClientProvider></I18nextProvider>);

    await screen.findAllByRole("button");
    expect(document.documentElement).toHaveAttribute("dir", "rtl");
    const inputs = container.querySelectorAll<HTMLInputElement>("input");
    for (const input of [inputs[0], inputs[1], inputs[2], inputs[4], inputs[5], inputs[6], inputs[7], inputs[8]]) {
      expect(input).toHaveAttribute("dir", "ltr");
    }
    expect(inputs[3]).not.toHaveAttribute("dir");
  });
});
