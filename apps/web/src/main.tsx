import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { I18nextProvider } from "react-i18next";
import { Toaster } from "sonner";
import { createAppQueryClient } from "./app/query-client";
import { createAppRouter } from "./app/router";
import { initializeI18n } from "./i18n";
import { initBrowserSentry } from "./lib/sentry";
import { initializeThemeColor } from "./lib/theme";
import { setToastI18n } from "./lib/toast";
import "./styles.css";

initBrowserSentry({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.VITE_SENTRY_ENVIRONMENT ?? import.meta.env.MODE,
  release: import.meta.env.VITE_SENTRY_RELEASE,
  sampleRate: import.meta.env.VITE_SENTRY_SAMPLE_RATE,
  tracesSampleRate: import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE,
});
initializeThemeColor();
const queryClient = createAppQueryClient();
const router = createAppRouter({ queryClient });

void initializeI18n().then((i18n) => {
  setToastI18n(i18n);
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <Toaster
        closeButton
        position="top-right"
        richColors
        theme="light"
        className="cssVar"
      />
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} context={{ queryClient }} />
        </QueryClientProvider>
      </I18nextProvider>
    </React.StrictMode>,
  );
});
