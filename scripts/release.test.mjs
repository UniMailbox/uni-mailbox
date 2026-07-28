import { describe, expect, it } from "vitest";
import {
  createVersionUploadDiagnostics,
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
      "deploy-direct",
    ]);
  });

  it("keeps candidate verification before the shared database safeguards", () => {
    expect(productionReleaseSteps("verified-version")).toEqual([
      "verify-candidate",
      "capture-bookmark",
      "migrate-production",
      "verify-migrations",
      "promote-version",
    ]);
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
