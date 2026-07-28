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
    ],
    coverage: {
      provider: "v8",
      include: [
        "packages/contracts/src/**/*.ts",
        "packages/config/src/**/*.ts",
        "packages/email-core/src/**/*.ts",
        "apps/worker/src/integrations/providers/index.ts",
        "apps/worker/src/modules/attachments/upload-token.ts",
        "apps/worker/src/modules/authorization/index.ts",
        "apps/worker/src/modules/identity/index.ts",
        "apps/worker/src/modules/signatures/index.ts",
        "apps/worker/src/platform/crypto.ts",
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