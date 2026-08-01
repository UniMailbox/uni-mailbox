import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import { createI18nInstance } from "../../i18n";
import { StorageSettings } from "./StorageSettings";

describe("StorageSettings", () => {
  it("maps infrastructure state and never displays the Worker storage reason", async () => {
    vi.spyOn(window, "fetch").mockResolvedValue(
      Response.json({
        data: {
          required: { d1: "ok", kv: "ok", queue: "missing", assets: "error" },
          attachments: {
            backend: "kv",
            r2: "missing",
            reason: "provider-only storage diagnostic",
          },
        },
      }),
    );
    render(
      <I18nextProvider i18n={createI18nInstance("en")}>
        <QueryClientProvider
          client={
            new QueryClient({ defaultOptions: { queries: { retry: false } } })
          }
        >
          <StorageSettings />
        </QueryClientProvider>
      </I18nextProvider>,
    );
    expect(await screen.findByText("KV storage is active")).toBeVisible();
    expect(screen.getByText("Not configured")).toBeVisible();
    expect(
      screen.queryByText("provider-only storage diagnostic"),
    ).not.toBeInTheDocument();
  });
});
