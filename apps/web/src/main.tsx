import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { I18nextProvider } from "react-i18next";
import { createAppQueryClient } from "./app/query-client";
import { createAppRouter } from "./app/router";
import { initializeI18n } from "./i18n";
import { initializeThemeColor } from "./lib/theme";
import "./styles.css";

initializeThemeColor();
const queryClient = createAppQueryClient();
const router = createAppRouter({ queryClient });

void initializeI18n().then((i18n) => {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} context={{ queryClient }} />
        </QueryClientProvider>
      </I18nextProvider>
    </React.StrictMode>,
  );
});
