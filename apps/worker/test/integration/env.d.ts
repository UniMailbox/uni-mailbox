import type { D1Migration } from "@cloudflare/vitest-pool-workers/config";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
    KV: KVNamespace;
    ATTACHMENTS?: R2Bucket;
    OUTBOUND_QUEUE: Queue;
    TEST_MIGRATIONS: D1Migration[];
  }
}
