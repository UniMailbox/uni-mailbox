import { describe, expect, it } from "vitest";
import {
  assertInstallationMatchesConfig,
  assertProductionRepository,
  createInstallationManifest,
  isOfficialRepository,
  mergeInstallationPackage,
  mergeInstallationWrangler,
  validateProductionSource,
} from "./deployment-lib.mjs";

const configuredWrangler = {
  name: "customer-mail",
  compatibility_date: "2026-07-23",
  d1_databases: [
    {
      binding: "DB",
      database_name: "customer-mail-db",
      database_id: "11111111-1111-1111-1111-111111111111",
    },
  ],
  kv_namespaces: [{ binding: "KV", id: "22222222222222222222222222222222" }],
  queues: {
    producers: [{ binding: "OUTBOUND_QUEUE", queue: "customer-outbound" }],
    consumers: [
      {
        queue: "customer-outbound",
        dead_letter_queue: "customer-outbound-dead",
      },
    ],
  },
};

const upstream = {
  schemaVersion: 1,
  sourceRepository: "UniMailbox/uni-mailbox",
  distributionRepository: "UniMailbox/unimailbox-deploy",
  channel: "stable",
  version: "0.2.0",
  tag: "v0.2.0",
  sourceCommit: "a".repeat(40),
};

describe("deployment adoption", () => {
  it("extracts only non-secret installation identifiers", () => {
    const manifest = createInstallationManifest({
      wrangler: configuredWrangler,
      r2Wrangler: {
        ...configuredWrangler,
        r2_buckets: [
          { binding: "ATTACHMENTS", bucket_name: "customer-attachments" },
        ],
      },
      upstream,
      repository: "customer/mail",
      deploymentUrl: "https://mail.example.com",
      adoptedAt: "2026-08-02T00:00:00.000Z",
    });

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      repository: "customer/mail",
      deploymentUrl: "https://mail.example.com",
      worker: { name: "customer-mail" },
      resources: {
        d1: {
          binding: "DB",
          name: "customer-mail-db",
          id: "11111111-1111-1111-1111-111111111111",
        },
        kv: [{ binding: "KV", id: "22222222222222222222222222222222" }],
        r2: [{ binding: "ATTACHMENTS", bucketName: "customer-attachments" }],
      },
      upstream,
    });
    expect(JSON.stringify(manifest)).not.toMatch(/password|token|secret/iu);
  });

  it("fails when Cloudflare has not written required resource IDs", () => {
    expect(() =>
      createInstallationManifest({
        wrangler: {
          ...configuredWrangler,
          d1_databases: [{ binding: "DB", database_name: "missing-id" }],
        },
        upstream,
        repository: "customer/mail",
        deploymentUrl: "https://mail.example.com",
      }),
    ).toThrow(/database_id/iu);
    expect(() =>
      createInstallationManifest({
        wrangler: {
          ...configuredWrangler,
          d1_databases: [
            {
              binding: "DB",
              database_name: "placeholder",
              database_id: "auto",
            },
          ],
        },
        upstream,
        repository: "customer/mail",
        deploymentUrl: "https://mail.example.com",
      }),
    ).toThrow(/Cloudflare-provisioned/iu);
  });

  it.each([
    [{ name: "", d1_databases: [], kv_namespaces: [], queues: {} }, /Worker/iu],
    [{ ...configuredWrangler, d1_databases: [] }, /D1 binding/iu],
    [{ ...configuredWrangler, kv_namespaces: [] }, /KV binding/iu],
    [
      {
        ...configuredWrangler,
        kv_namespaces: [{ binding: "KV", id: "not-provisioned" }],
      },
      /Cloudflare-provisioned/iu,
    ],
    [
      { ...configuredWrangler, queues: { producers: [], consumers: [] } },
      /Queue/iu,
    ],
  ])("rejects incomplete provisioned bindings", (wrangler, error) => {
    expect(() =>
      createInstallationManifest({
        wrangler,
        upstream,
        repository: "customer/mail",
        deploymentUrl: "https://mail.example.com",
      }),
    ).toThrow(error);
  });

  it("rejects unsafe URLs and inconsistent upstream manifests", () => {
    const build = (overrides = {}) =>
      createInstallationManifest({
        wrangler: configuredWrangler,
        upstream,
        repository: "customer/mail",
        deploymentUrl: "https://mail.example.com",
        ...overrides,
      });
    expect(() => build({ deploymentUrl: "http://mail.example.com" })).toThrow(
      /HTTPS/iu,
    );
    expect(() => build({ upstream: { ...upstream, channel: "edge" } })).toThrow(
      /stable/iu,
    );
    expect(() => build({ upstream: { ...upstream, tag: "v9.9.9" } })).toThrow(
      /tag/iu,
    );
    expect(() =>
      build({ upstream: { ...upstream, sourceCommit: "short" } }),
    ).toThrow(/full Git commit SHA/iu);
    expect(() =>
      build({ upstream: { ...upstream, sourceRepository: "" } }),
    ).toThrow(/sourceRepository/iu);
  });

  it("detects a resource mismatch after adoption", () => {
    const manifest = createInstallationManifest({
      wrangler: configuredWrangler,
      upstream,
      repository: "customer/mail",
      deploymentUrl: "https://mail.example.com",
    });
    const changed = structuredClone(configuredWrangler);
    changed.kv_namespaces[0].id = "different";
    expect(() => assertInstallationMatchesConfig(manifest, changed)).toThrow(
      /KV/iu,
    );
  });

  it("detects adopted queue consumer and R2 mismatches", () => {
    const r2Wrangler = {
      ...configuredWrangler,
      r2_buckets: [
        { binding: "ATTACHMENTS", bucket_name: "customer-attachments" },
      ],
    };
    const manifest = createInstallationManifest({
      wrangler: configuredWrangler,
      r2Wrangler,
      upstream,
      repository: "customer/mail",
      deploymentUrl: "https://mail.example.com",
    });
    const changedQueue = structuredClone(configuredWrangler);
    changedQueue.queues.consumers[0].dead_letter_queue = "wrong-dead-letter";
    expect(() =>
      assertInstallationMatchesConfig(manifest, changedQueue, r2Wrangler),
    ).toThrow(/consumer/iu);

    const changedR2 = structuredClone(r2Wrangler);
    changedR2.r2_buckets[0].bucket_name = "wrong-bucket";
    expect(() =>
      assertInstallationMatchesConfig(manifest, configuredWrangler, changedR2),
    ).toThrow(/R2/iu);
    expect(() =>
      assertInstallationMatchesConfig(manifest, configuredWrangler),
    ).toThrow(/R2/iu);

    const changedR2Database = structuredClone(r2Wrangler);
    changedR2Database.d1_databases[0].database_id = "wrong-database";
    expect(() =>
      assertInstallationMatchesConfig(
        manifest,
        configuredWrangler,
        changedR2Database,
      ),
    ).toThrow(/D1/iu);
  });

  it("fails closed for malformed manifests and primary resource mismatches", () => {
    const manifest = createInstallationManifest({
      wrangler: configuredWrangler,
      upstream,
      repository: "customer/mail",
      deploymentUrl: "https://mail.example.com",
    });
    expect(() =>
      assertInstallationMatchesConfig(
        { ...manifest, schemaVersion: 2 },
        configuredWrangler,
      ),
    ).toThrow(/schemaVersion/iu);
    expect(() =>
      assertInstallationMatchesConfig(
        { ...manifest, worker: { name: "different" } },
        configuredWrangler,
      ),
    ).toThrow(/Worker/iu);
    expect(() =>
      assertInstallationMatchesConfig(manifest, {
        ...configuredWrangler,
        d1_databases: [],
      }),
    ).toThrow(/D1/iu);
    const queueChanged = structuredClone(configuredWrangler);
    queueChanged.queues.producers[0].queue = "different";
    expect(() =>
      assertInstallationMatchesConfig(manifest, queueChanged),
    ).toThrow(/Queue/iu);
    expect(() =>
      assertInstallationMatchesConfig(manifest, configuredWrangler),
    ).not.toThrow();
  });
});

describe("production source gate", () => {
  it("rejects official repositories and permits installation repositories", () => {
    expect(() => assertProductionRepository("UniMailbox/uni-mailbox")).toThrow(
      /installation repository/iu,
    );
    expect(() =>
      assertProductionRepository("UniMailbox/unimailbox-deploy"),
    ).toThrow(/installation repository/iu);
    expect(() => assertProductionRepository("customer/mail")).not.toThrow();
  });

  it("requires the exact remote main commit", () => {
    expect(() =>
      validateProductionSource({
        ref: "refs/heads/main",
        sha: "a".repeat(40),
        remoteMainSha: "b".repeat(40),
      }),
    ).toThrow(/remote main HEAD/iu);
    expect(() =>
      validateProductionSource({
        ref: "refs/heads/feature",
        sha: "a".repeat(40),
        remoteMainSha: "a".repeat(40),
      }),
    ).toThrow(/refs\/heads\/main/iu);
    expect(() =>
      validateProductionSource({
        ref: "refs/heads/main",
        sha: "short",
        remoteMainSha: "short",
      }),
    ).toThrow(/full Git commit SHA/iu);
    expect(() =>
      validateProductionSource({
        ref: "refs/heads/main",
        sha: "a".repeat(40),
        remoteMainSha: "a".repeat(40),
      }),
    ).not.toThrow();
    expect(isOfficialRepository("UniMailbox/uni-mailbox")).toBe(true);
    expect(isOfficialRepository("customer/mail")).toBe(false);
  });
});

describe("structured upstream merge", () => {
  it("keeps installation resource identifiers while accepting upstream config", () => {
    const customized = structuredClone(configuredWrangler);
    customized.d1_databases.push({
      binding: "CUSTOM_DB",
      database_name: "customer-custom",
      database_id: "33333333-3333-3333-3333-333333333333",
    });
    customized.kv_namespaces.push({
      binding: "CUSTOM_KV",
      id: "44444444444444444444444444444444",
    });
    customized.queues.producers.push({
      binding: "CUSTOM_QUEUE",
      queue: "customer-custom-queue",
    });
    customized.queues.consumers.push({ queue: "customer-custom-queue" });
    const next = mergeInstallationWrangler({
      current: customized,
      upstream: {
        name: "unimailbox",
        compatibility_date: "2026-08-01",
        compatibility_flags: ["nodejs_compat", "global_fetch_strictly_public"],
        d1_databases: [
          { binding: "DB", database_name: "unimailbox", database_id: "auto" },
          { binding: "AUDIT_DB", database_name: "unimailbox-audit" },
        ],
        kv_namespaces: [
          { binding: "KV", id: "auto" },
          { binding: "CACHE", id: "auto" },
        ],
        queues: {
          producers: [
            { binding: "OUTBOUND_QUEUE", queue: "unimailbox-outbound" },
            { binding: "INDEX_QUEUE", queue: "unimailbox-index" },
          ],
          consumers: [{ queue: "unimailbox-outbound", max_retries: 9 }],
        },
      },
    });

    expect(next.name).toBe("customer-mail");
    expect(next.compatibility_date).toBe("2026-08-01");
    expect(next.d1_databases[0]).toMatchObject({
      binding: "DB",
      database_name: "customer-mail-db",
      database_id: "11111111-1111-1111-1111-111111111111",
    });
    expect(next.d1_databases[1].binding).toBe("AUDIT_DB");
    expect(next.kv_namespaces[0].id).toBe("22222222222222222222222222222222");
    expect(next.kv_namespaces[1].binding).toBe("CACHE");
    expect(next.queues.producers[0].queue).toBe("customer-outbound");
    expect(next.queues.consumers[0]).toMatchObject({
      queue: "customer-outbound",
      max_retries: 9,
      dead_letter_queue: "customer-outbound-dead",
    });
    expect(next.d1_databases).toContainEqual(
      expect.objectContaining({ binding: "CUSTOM_DB" }),
    );
    expect(next.kv_namespaces).toContainEqual(
      expect.objectContaining({ binding: "CUSTOM_KV" }),
    );
    expect(next.queues.producers).toContainEqual(
      expect.objectContaining({ binding: "CUSTOM_QUEUE" }),
    );
    expect(next.queues.consumers).toContainEqual({
      queue: "customer-custom-queue",
    });
  });

  it("keeps the installation package name and accepts the stable app version", () => {
    expect(
      mergeInstallationPackage({
        current: { name: "customer-mail", version: "0.1.0", private: true },
        upstream: {
          name: "unimailbox",
          version: "0.2.0",
          private: true,
          scripts: { test: "vitest run" },
          dependencies: { hono: "5.0.0" },
        },
      }),
    ).toEqual({
      name: "customer-mail",
      version: "0.2.0",
      private: true,
      scripts: { test: "vitest run" },
      dependencies: { hono: "5.0.0" },
    });
    expect(
      mergeInstallationPackage({ current: {}, upstream: { name: "upstream" } }),
    ).toEqual({ name: "upstream" });
  });

  it("supports an upstream config without queues or R2", () => {
    expect(
      mergeInstallationWrangler({
        current: {},
        upstream: { name: "unimailbox", compatibility_date: "2026-08-01" },
      }),
    ).toEqual({
      name: "unimailbox",
      compatibility_date: "2026-08-01",
      d1_databases: [],
      kv_namespaces: [],
      queues: { producers: [], consumers: [] },
    });
  });
});
