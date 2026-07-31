import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import { createI18nInstance } from "../../i18n";
import { CloudflareSettings } from "./CloudflareSettings";

describe("CloudflareSettings", () => {
  it("maps checkpoint states to localized product copy instead of provider diagnostics", async () => {
    vi.spyOn(window, "fetch").mockResolvedValue(Response.json({ data: [{ checkpointKey: "cloudflare_mail", status: "failed", metadata: {}, errorCode: "CLOUDFLARE_API_FAILED", errorMessage: "provider-only diagnostic", verifiedAt: null }] }));
    render(<I18nextProvider i18n={createI18nInstance("en")}><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><CloudflareSettings /></QueryClientProvider></I18nextProvider>);
    expect(await screen.findByText("Connect the control plane")).toBeVisible();
    expect(screen.getByText("Action required")).toBeVisible();
    expect(screen.queryByText("provider-only diagnostic")).not.toBeInTheDocument();
  });
});
