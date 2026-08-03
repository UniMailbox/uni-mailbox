import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import { fileURLToPath, URL } from "node:url";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const uploadSourceMaps = Boolean(
    env.SENTRY_AUTH_TOKEN && env.SENTRY_ORG && env.SENTRY_PROJECT,
  );

  return {
    plugins: [
      react(),
      tailwindcss(),
      ...(uploadSourceMaps
        ? [
            sentryVitePlugin({
              authToken: env.SENTRY_AUTH_TOKEN,
              org: env.SENTRY_ORG,
              project: env.SENTRY_PROJECT,
              release: env.SENTRY_RELEASE
                ? { name: env.SENTRY_RELEASE }
                : undefined,
              sourcemaps: { filesToDeleteAfterUpload: ["dist/**/*.map"] },
            }),
          ]
        : []),
    ],
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    },
    build: {
      outDir: "dist",
      sourcemap: uploadSourceMaps ? "hidden" : false,
    },
    server: {
      proxy: {
        // Must match `dev.port` in the root wrangler.jsonc. The same-origin
        // assumption matters: the refresh cookie (HttpOnly, SameSite=Strict)
        // only travels because both halves of the proxy agree on the origin.
        "/api": "http://127.0.0.1:8787",
        "/health": "http://127.0.0.1:8787",
      },
    },
    test: {
      environment: "jsdom",
      setupFiles: ["./src/test/setup.ts"],
    },
  };
});
