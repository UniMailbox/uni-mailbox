import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    sourcemap: true,
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
});
