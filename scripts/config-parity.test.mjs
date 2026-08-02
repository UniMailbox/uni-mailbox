import { describe, expect, it } from "vitest";
import { findWranglerParityErrors } from "./config-parity-lib.mjs";

function config() {
  return {
    name: "unimailbox",
    main: "apps/worker/src/index.ts",
    compatibility_date: "2026-08-01",
    compatibility_flags: ["nodejs_compat"],
    version_metadata: { binding: "CF_VERSION_METADATA" },
    assets: { binding: "ASSETS", directory: "apps/web/dist" },
    d1_databases: [{ binding: "DB", database_name: "unimailbox" }],
    kv_namespaces: [{ binding: "KV" }],
    queues: {
      producers: [{ binding: "OUTBOUND_QUEUE", queue: "outbound" }],
      consumers: [{ queue: "outbound", max_retries: 5 }],
    },
    triggers: { crons: ["* * * * *"] },
    env: {
      preview: {
        main: "apps/worker/src/index.ts",
        compatibility_date: "2026-08-01",
        compatibility_flags: ["nodejs_compat"],
        version_metadata: { binding: "CF_VERSION_METADATA" },
        assets: { binding: "ASSETS", directory: "apps/web/dist" },
        d1_databases: [{ binding: "DB", database_name: "preview" }],
        kv_namespaces: [{ binding: "KV" }],
        queues: { producers: [{ binding: "OUTBOUND_QUEUE" }] },
        triggers: { crons: ["* * * * *"] },
      },
    },
  };
}

describe("Wrangler configuration parity", () => {
  it("accepts an R2-only overlay difference", () => {
    expect(
      findWranglerParityErrors(config(), {
        ...config(),
        r2_buckets: [{ binding: "ATTACHMENTS", bucket_name: "attachments" }],
      }),
    ).toEqual([]);
  });

  it("reports missing bindings and runtime metadata", () => {
    const overlay = config();
    delete overlay.version_metadata;
    overlay.kv_namespaces = [];
    expect(findWranglerParityErrors(config(), overlay)).toEqual(
      expect.arrayContaining([
        "version_metadata differs",
        "overlay must bind version metadata as CF_VERSION_METADATA",
        "kv_namespaces bindings differ: KV != (none)",
      ]),
    );
  });

  it("checks preview bindings as well as production bindings", () => {
    const base = config();
    const overlay = structuredClone(base);
    overlay.env.preview.d1_databases = [];
    expect(findWranglerParityErrors(base, overlay)).toContain(
      "env.preview.d1_databases bindings differ: DB != (none)",
    );
  });

  it("requires version metadata in every explicit environment", () => {
    const base = config();
    const overlay = structuredClone(base);
    delete overlay.env.preview.version_metadata;
    expect(findWranglerParityErrors(base, overlay)).toEqual(
      expect.arrayContaining([
        "env.preview.version_metadata differs",
        "overlay env.preview must bind version metadata as CF_VERSION_METADATA",
      ]),
    );
  });
});
