import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "packages/contracts/test/**/*.test.ts",
      "packages/config/test/**/*.test.ts",
      "packages/email-core/test/**/*.test.ts",
      "apps/worker/test/unit/**/*.test.ts",
      "apps/worker/test/worker/**/*.test.ts",
      "scripts/*.test.mjs",
    ],
    coverage: {
      provider: "v8",
      include: [
        "packages/contracts/src/**/*.ts",
        "packages/config/src/**/*.ts",
        "packages/email-core/src/**/*.ts",
        "apps/worker/src/integrations/providers/index.ts",
        "apps/worker/src/modules/attachments/upload-token.ts",
        "apps/worker/src/modules/attachments/download-response.ts",
        "apps/worker/src/modules/authorization/index.ts",
        "apps/worker/src/modules/identity/index.ts",
        "apps/worker/src/modules/maintenance/index.ts",
        "apps/worker/src/modules/maintenance/orphan-policy.ts",
        "apps/worker/src/modules/signatures/index.ts",
        "apps/worker/src/platform/attachment-store.ts",
        "apps/worker/src/platform/crypto.ts",
        "scripts/attachment-migration-lib.mjs",
        "scripts/release-lib.mjs",
      ],
      exclude: [
        "packages/contracts/src/events/index.ts",
        "apps/worker/src/platform/schema.ts",
      ],
      thresholds: {
        branches: 99,
        functions: 99,
        lines: 99,
        statements: 99,
      },
    },
  },
});
