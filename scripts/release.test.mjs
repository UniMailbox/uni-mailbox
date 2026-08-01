import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createVersionUploadDiagnostics,
  parseD1CountResult,
  parseRuntimeSecretList,
  parseVersionUploadResult,
  productionBranchFromEnvironment,
  productionReleaseSteps,
  selectProductionReleaseMode,
} from "./release-lib.mjs";

const versionId = "123e4567-e89b-12d3-a456-426614174000";
const previewUrl =
  "https://release-candidate-unimailbox-demo.example.workers.dev";

describe("release output parsing", () => {
  it("reads the structured output emitted by Wrangler in Workers Builds", () => {
    const outputFile = [
      JSON.stringify({ type: "deploy", version: 1 }),
      JSON.stringify({
        type: "version-upload",
        version: 1,
        worker_name: "unimailbox-demo",
        version_id: versionId,
        preview_url: "https://123e4567-unimailbox-demo.example.workers.dev",
        preview_alias_url: previewUrl,
      }),
    ].join("\n");

    expect(
      parseVersionUploadResult({
        outputFile,
        stdout: "",
        stderr: "",
      }),
    ).toEqual({ workerVersionId: versionId, previewUrl });
  });

  it("retains a human-readable output fallback outside Workers Builds", () => {
    expect(
      parseVersionUploadResult({
        outputFile: "",
        stdout: [
          `Worker Version ID: ${versionId}`,
          `Version Preview Alias URL: ${previewUrl}`,
        ].join("\n"),
        stderr: "",
      }),
    ).toEqual({ workerVersionId: versionId, previewUrl });
  });

  it("ignores malformed entries and accepts Wrangler's version preview URL", () => {
    const outputFile = [
      "not-json",
      JSON.stringify({ type: "deploy", version: 1 }),
      JSON.stringify({
        type: "version-upload",
        version_id: null,
        preview_alias_url: null,
        preview_url: previewUrl,
      }),
    ].join("\n");

    expect(
      parseVersionUploadResult({
        outputFile,
        stdout: `Version ID: ${versionId}`,
        stderr: "",
      }),
    ).toEqual({ workerVersionId: versionId, previewUrl });
  });

  it("returns partial details when Wrangler omits preview metadata", () => {
    expect(
      parseVersionUploadResult({
        outputFile: `${JSON.stringify({
          type: "version-upload",
          version_id: null,
          preview_alias_url: 42,
          preview_url: null,
        })}\n`,
        stdout: "",
        stderr: `Uploaded version ${versionId}`,
      }),
    ).toEqual({ workerVersionId: versionId, previewUrl: undefined });

    expect(
      parseVersionUploadResult({
        outputFile: "",
        stdout: "",
        stderr: "",
      }),
    ).toEqual({ workerVersionId: undefined, previewUrl: undefined });
  });
});

describe("production release fallback", () => {
  it("uses direct deployment when candidate verification metadata is incomplete", () => {
    expect(
      selectProductionReleaseMode({
        workerVersionId: versionId,
        previewUrl: undefined,
      }),
    ).toBe("direct-deploy");
    expect(
      selectProductionReleaseMode({
        workerVersionId: undefined,
        previewUrl,
      }),
    ).toBe("direct-deploy");
  });

  it("retains candidate verification when both required fields are available", () => {
    expect(
      selectProductionReleaseMode({
        workerVersionId: versionId,
        previewUrl,
      }),
    ).toBe("verified-version");
  });

  it("keeps database recovery and verification in the direct-deploy fallback", () => {
    expect(productionReleaseSteps("direct-deploy")).toEqual([
      "capture-bookmark",
      "migrate-production",
      "verify-migrations",
      "bootstrap-administrator",
      "deploy-direct",
    ]);
  });

  it("bootstraps a fresh database before candidate HTTP verification", () => {
    expect(productionReleaseSteps("verified-version")).toEqual([
      "capture-bookmark",
      "migrate-production",
      "verify-migrations",
      "bootstrap-administrator",
      "verify-candidate",
      "promote-version",
    ]);
  });

  it("accepts only Wrangler secret-list arrays with named entries", () => {
    expect(
      parseRuntimeSecretList(
        JSON.stringify([
          { name: "AUTH_SIGNING_KEY", type: "secret_text" },
          { name: "CREDENTIAL_ENCRYPTION_KEY", type: "secret_text" },
        ]),
      ),
    ).toEqual(["AUTH_SIGNING_KEY", "CREDENTIAL_ENCRYPTION_KEY"]);

    expect(() => parseRuntimeSecretList('{"name":"AUTH_SIGNING_KEY"}')).toThrow(
      /array/iu,
    );
    expect(() => parseRuntimeSecretList('[{"name":42}]')).toThrow(
      /named entries/iu,
    );
    expect(() => parseRuntimeSecretList("not-json")).toThrow(/valid JSON/iu);
  });

  it("reads guarded D1 counts without accepting malformed output", () => {
    expect(
      parseD1CountResult(
        JSON.stringify([
          {
            success: true,
            results: [{ encrypted_credential_count: 0 }],
          },
        ]),
        "encrypted_credential_count",
      ),
    ).toBe(0);
    expect(() => parseD1CountResult("[]", "count")).toThrow(
      /did not return count/iu,
    );
    expect(() => parseD1CountResult("not-json", "count")).toThrow(
      /valid JSON/iu,
    );
  });

  it("reports safe diagnostics when Workers Builds omits structured output", () => {
    expect(
      createVersionUploadDiagnostics({
        outputFileExists: false,
        outputFile: "",
        stdout: "Upload complete",
        stderr: "Authorization: Bearer secret-token",
      }),
    ).toEqual({
      outputFileExists: false,
      outputFileBytes: 0,
      outputEntryTypes: [],
      malformedOutputLines: 0,
      stdoutBytes: 15,
      stderrBytes: 34,
      stdoutExcerpt: "Upload complete",
      stderrExcerpt: "Authorization: Bearer [REDACTED]",
    });
  });
});

describe("Workers Builds branch detection", () => {
  it("prefers the Cloudflare production trigger branch", () => {
    expect(
      productionBranchFromEnvironment({
        WORKERS_CI_BRANCH: "main",
        GITHUB_REF_NAME: "feature/mailbox",
      }),
    ).toBe("main");
  });
});

describe("production release orchestration", () => {
  it("bootstraps through the direct-deploy fallback without exposing generated secrets", () => {
    const directory = mkdtempSync(join(tmpdir(), "unimailbox-release-"));
    const fakePnpm = join(directory, "pnpm");
    const bootstrapState = join(directory, "administrator-created");
    const secretPathRecord = join(directory, "secret-path");
    writeFileSync(
      fakePnpm,
      `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const has = (value) => args.includes(value);
const command = args.join(" ");
if (args[0] === "build") process.exit(0);
if (has("deploy") && has("--dry-run")) {
  const outdir = args[args.indexOf("--outdir") + 1];
  fs.mkdirSync(outdir, { recursive: true });
  fs.writeFileSync(path.join(outdir, "index.js"), "export default {};");
  process.exit(0);
}
if (has("deployments") && has("status")) {
  process.stdout.write("[]");
  process.exit(0);
}
if (has("secret") && has("list")) {
  process.stdout.write("[]");
  process.exit(0);
}
if (has("versions") && has("upload")) {
  const secretPath = args[args.indexOf("--secrets-file") + 1];
  if (!secretPath || !fs.existsSync(secretPath)) process.exit(21);
  fs.writeFileSync(process.env.FAKE_SECRET_PATH_RECORD, secretPath);
  process.stdout.write("candidate uploaded without metadata");
  process.exit(0);
}
if (has("time-travel") && has("info")) {
  process.stdout.write(JSON.stringify({ bookmark: "bookmark-1" }));
  process.exit(0);
}
if (has("migrations") && has("apply")) process.exit(0);
if (has("d1") && has("execute")) {
  const sql = has("--command") ? args[args.indexOf("--command") + 1] : "";
  const file = has("--file") ? args[args.indexOf("--file") + 1] : "";
  const verificationAliases = [
    "required_tables_present",
    "permission_seed_complete",
    "recovery_codes_table_present",
    "zero_touch_bootstrap_valid",
  ];
  if (sql.includes("migration_table_present")) {
    process.stdout.write(JSON.stringify([{
      success: true,
      results: [{ migration_table_present: 0, application_schema_present: 0 }]
    }]));
    process.exit(0);
  }
  if (verificationAliases.some((alias) => sql.includes(alias))) {
    process.stdout.write(JSON.stringify([
      { success: true, results: [{ migration_verified: 1 }] },
      { success: true, results: [] }
    ]));
    process.exit(0);
  }
  if (sql.includes("administrator_count")) {
    const count = fs.existsSync(process.env.FAKE_BOOTSTRAP_STATE) ? 1 : 0;
    process.stdout.write(JSON.stringify([{ success: true, results: [{ administrator_count: count }] }]));
    process.exit(0);
  }
  if (sql.includes("current_step")) {
    process.stdout.write(JSON.stringify([{ success: true, results: [{ current_step: "complete" }] }]));
    process.exit(0);
  }
  if (file.includes("administrator-bootstrap")) {
    fs.writeFileSync(process.env.FAKE_BOOTSTRAP_STATE, "created");
    process.stdout.write(JSON.stringify([{ success: true, results: [] }]));
    process.exit(0);
  }
  process.stdout.write(JSON.stringify([
    { success: true, results: [{ migration_verified: 1 }] },
    { success: true, results: [] }
  ]));
  process.exit(0);
}
if (has("deploy")) {
  const secretPath = args[args.indexOf("--secrets-file") + 1];
  if (!secretPath || !fs.existsSync(secretPath)) process.exit(22);
  process.exit(0);
}
process.stderr.write("Unexpected fake pnpm command: " + command);
process.exit(23);
`,
    );
    chmodSync(fakePnpm, 0o700);

    try {
      const result = spawnSync("node", ["scripts/release.mjs", "production"], {
        cwd: resolve(import.meta.dirname, ".."),
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${directory}:${process.env.PATH}`,
          FAKE_BOOTSTRAP_STATE: bootstrapState,
          FAKE_SECRET_PATH_RECORD: secretPathRecord,
          INITIAL_ADMIN_EMAIL: "admin@example.test",
          INITIAL_ADMIN_PASSWORD: "test-bootstrap-password",
          WORKERS_CI: "1",
          WORKERS_CI_BRANCH: "main",
        },
      });

      expect(result.status, result.stderr || result.stdout).toBe(0);
      expect(result.stdout).toContain('"releaseMode":"direct-deploy"');
      expect(result.stdout).toContain('"event":"release.completed"');
      expect(result.stdout).not.toContain("test-bootstrap-password");
      const temporarySecretPath = readFileSync(secretPathRecord, "utf8");
      expect(() => readFileSync(temporarySecretPath)).toThrow();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 15_000);
});
