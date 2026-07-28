import { describe, expect, it } from "vitest";
import { parseVersionUploadResult } from "./release-lib.mjs";

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
