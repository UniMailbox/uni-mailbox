#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertMigrationSet,
  capture,
  fail,
  output,
  root,
  run,
} from "./_shared.mjs";

const target = process.argv[2];
if (!["preview", "production", "rollback"].includes(target)) {
  fail("release.usage", "Usage: release.mjs preview|production|rollback", 2);
}
const manifestPath = resolve(root, ".wrangler/release/manifest.json");

if (target === "rollback") {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!manifest.promoted) {
    output("release.rollback.not_required", {
      status: "ok",
      message: "The failed release was not promoted",
    });
    process.exit(0);
  }
  if (!manifest.previousVersionId) {
    fail(
      "release.rollback_unavailable",
      "The release manifest has no previous Worker version",
      10,
    );
  }
  run("pnpm", [
    "exec",
    "wrangler",
    "rollback",
    manifest.previousVersionId,
    "--yes",
    "--message",
    `Automated rollback after failed verification for ${manifest.commit}`,
  ]);
  output("release.rollback.completed", {
    status: "ok",
    versionId: manifest.previousVersionId,
  });
  process.exit(0);
}
if (
  target === "production" &&
  process.env.GITHUB_REF_NAME &&
  !["main", "master"].includes(process.env.GITHUB_REF_NAME)
) {
  fail(
    "release.branch_forbidden",
    "Production releases may run only from the protected production branch",
    8,
  );
}

const migrations = assertMigrationSet();
run("pnpm", ["build"]);
run("pnpm", [
  "exec",
  "wrangler",
  "deploy",
  "--dry-run",
  "--outdir",
  ".wrangler/release",
]);
const artifactPath = resolve(root, ".wrangler/release/index.js");
const digest = createHash("sha256")
  .update(readFileSync(artifactPath))
  .digest("hex");
const git = capture("git", ["rev-parse", "HEAD"]);
const manifest = {
  target,
  commit: git.ok ? git.stdout : "unknown",
  artifact: "index.js",
  sha256: digest,
  migrations,
  createdAt: new Date().toISOString(),
};
mkdirSync(resolve(root, ".wrangler/release"), { recursive: true });
function writeManifest() {
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}
function captureRequired(command, args, event) {
  output("command.started", { command, args });
  const result = capture(command, args);
  if (!result.ok) {
    fail(event, result.stderr || result.stdout, 9, { command, args });
  }
  output("command.completed", { command, args });
  return `${result.stdout}\n${result.stderr}`;
}
function deployedVersionId(raw) {
  try {
    const entries = [];
    const visit = (value) => {
      if (!value || typeof value !== "object") return;
      if ("version_id" in value && typeof value.version_id === "string") {
        entries.push({
          id: value.version_id,
          percentage:
            typeof value.percentage === "number" ? value.percentage : 0,
        });
      }
      for (const child of Object.values(value)) visit(child);
    };
    visit(JSON.parse(raw));
    return entries.sort((left, right) => right.percentage - left.percentage)[0]
      ?.id;
  } catch {
    return undefined;
  }
}
writeManifest();
output("release.artifact.created", manifest);

if (target === "preview") {
  run("pnpm", [
    "exec",
    "wrangler",
    "versions",
    "upload",
    "--env",
    "preview",
    "--preview-alias",
    "release-candidate",
  ]);
} else {
  const current = capture("pnpm", [
    "exec",
    "wrangler",
    "deployments",
    "status",
    "--json",
  ]);
  const currentDeployment = current.ok ? current.stdout : "";
  const previousVersionId = deployedVersionId(currentDeployment) ?? null;
  const candidate = captureRequired(
    "pnpm",
    [
      "exec",
      "wrangler",
      "versions",
      "upload",
      "--preview-alias",
      "release-candidate",
      "--tag",
      `release-${manifest.commit.slice(0, 12)}`,
      "--message",
      `UniMailbox release ${manifest.commit}`,
    ],
    "release.version_upload_failed",
  );
  const workerVersionId =
    candidate.match(
      /(?:Worker Version ID|Version ID)\s*:\s*([0-9a-f-]{36})/iu,
    )?.[1] ??
    candidate.match(/\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/iu)?.[0];
  const previewUrl = candidate.match(/https:\/\/[^\s]+\.workers\.dev/iu)?.[0];
  if (!workerVersionId || !previewUrl) {
    fail(
      "release.version_output_invalid",
      "Wrangler did not return a candidate version ID and preview URL",
      9,
    );
  }
  Object.assign(manifest, {
    previousVersionId,
    workerVersionId,
    previewUrl,
  });
  writeManifest();
  run("node", ["scripts/verify-deployment.mjs", previewUrl]);

  const bookmarkOutput = captureRequired(
    "pnpm",
    ["exec", "wrangler", "d1", "time-travel", "info", "DB", "--json"],
    "release.bookmark_failed",
  );
  let d1Bookmark;
  try {
    const start = Math.min(
      ...["{", "["]
        .map((character) => bookmarkOutput.indexOf(character))
        .filter((index) => index >= 0),
    );
    const end = Math.max(
      bookmarkOutput.lastIndexOf("}"),
      bookmarkOutput.lastIndexOf("]"),
    );
    d1Bookmark = JSON.parse(bookmarkOutput.slice(start, end + 1));
  } catch {
    fail(
      "release.bookmark_output_invalid",
      "D1 Time Travel did not return valid JSON",
      9,
    );
  }
  Object.assign(manifest, { d1Bookmark });
  writeManifest();
  run("node", [
    "scripts/migration.mjs",
    "migrate",
    "--target",
    "production",
    "--confirm",
    manifest.commit,
  ]);
  run("node", ["scripts/migration.mjs", "verify", "--target", "production"]);
  run("pnpm", [
    "exec",
    "wrangler",
    "versions",
    "deploy",
    `${workerVersionId}@100%`,
    "--yes",
    "--message",
    `Promote UniMailbox ${manifest.commit}`,
  ]);
  Object.assign(manifest, {
    promoted: true,
    promotedAt: new Date().toISOString(),
  });
  writeManifest();
}
output("release.completed", { status: "ok", ...manifest });
