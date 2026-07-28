import {
  defineWorkersConfig,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    test: {
      include: ["apps/worker/test/integration/**/*.test.ts"],
      pool: "@cloudflare/vitest-pool-workers",
      poolOptions: {
        workers: {
          isolatedStorage: true,
          miniflare: {
            compatibilityDate: "2026-07-23",
            compatibilityFlags: ["nodejs_compat"],
            d1Databases: ["DB"],
            r2Buckets: ["ATTACHMENTS"],
            kvNamespaces: ["KV"],
            queueProducers: {
              OUTBOUND_QUEUE: "unimailbox-test",
            },
            bindings: {
              TEST_MIGRATIONS: migrations,
            },
          },
        },
      },
    },
  };
});
