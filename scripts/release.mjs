#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import {
  assertMigrationSet,
  capture,
  fail,
  output,
  root,
  run,
} from "./_shared.mjs";
import {
  createVersionUploadDiagnostics,
  parseVersionUploadResult,
  productionBranchFromEnvironment,
  productionReleaseSteps,
  selectProductionReleaseMode,
} from "./release-lib.mjs";

const target = process.argv[2];
if (!["preview", "production", "rollback"].includes(target)) {
  fail("release.usage", "Usage: release.mjs preview|production|rollback", 2);
}
const manifestPath = resolve(root, ".wrangler/release/manifest.json");
const productionBranch = productionBranchFromEnvironment(process.env);
output("release.context", {
  target,
  workersBuild: process.env.WORKERS_CI === "1",
  branch: productionBranch ?? null,
  buildUuid: process.env.WORKERS_CI_BUILD_UUID ?? null,
});

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
    "--env",
    "",
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
  productionBranch &&
  !["main", "master"].includes(productionBranch)
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
  "--env",
  "",
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
function captureRequired(command, args, event, options = {}) {
  output("command.started", { command, args });
  const result = capture(command, args, options);
  if (!result.ok) {
    fail(event, result.stderr || result.stdout, 9, { command, args });
  }
  output("command.completed", { command, args });
  return result;
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
function captureD1Bookmark() {
  const bookmark = captureRequired(
    "pnpm",
    [
      "exec",
      "wrangler",
      "d1",
      "time-travel",
      "info",
      "DB",
      "--env",
      "",
      "--json",
    ],
    "release.bookmark_failed",
  );
  const bookmarkOutput = `${bookmark.stdout}\n${bookmark.stderr}`;
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
}
function migrateProduction() {
  run("node", [
    "scripts/migration.mjs",
    "migrate",
    "--target",
    "production",
    "--confirm",
    manifest.commit,
  ]);
}
function verifyProductionMigrations() {
  run("node", ["scripts/migration.mjs", "verify", "--target", "production"]);
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
    "--env",
    "",
    "--json",
  ]);
  const currentDeployment = current.ok ? current.stdout : "";
  const previousVersionId = deployedVersionId(currentDeployment) ?? null;
  const versionOutputPath = resolve(
    root,
    ".wrangler/release/version-upload.jsonl",
  );
  if (existsSync(versionOutputPath)) unlinkSync(versionOutputPath);
  const candidate = captureRequired(
    "pnpm",
    [
      "exec",
      "wrangler",
      "versions",
      "upload",
      "--env",
      "",
      "--preview-alias",
      "release-candidate",
      "--tag",
      `release-${manifest.commit.slice(0, 12)}`,
      "--message",
      `UniMailbox release ${manifest.commit}`,
    ],
    "release.version_upload_failed",
    {
      env: {
        ...process.env,
        WRANGLER_OUTPUT_FILE_PATH: versionOutputPath,
      },
    },
  );
  const outputFileExists = existsSync(versionOutputPath);
  const versionOutput = outputFileExists
    ? readFileSync(versionOutputPath, "utf8")
    : "";
  const { workerVersionId, previewUrl } = parseVersionUploadResult({
    outputFile: versionOutput,
    stdout: candidate.stdout,
    stderr: candidate.stderr,
  });
  const releaseMode = selectProductionReleaseMode({
    workerVersionId,
    previewUrl,
  });
  const versionDiagnostics = createVersionUploadDiagnostics({
    outputFileExists,
    outputFile: versionOutput,
    stdout: candidate.stdout,
    stderr: candidate.stderr,
  });
  output("release.version_output.inspected", {
    status: releaseMode === "verified-version" ? "ok" : "degraded",
    releaseMode,
    workerVersionIdFound: Boolean(workerVersionId),
    previewUrlFound: Boolean(previewUrl),
    ...versionDiagnostics,
  });
  Object.assign(manifest, {
    previousVersionId,
    releaseMode,
    ...(workerVersionId ? { workerVersionId } : {}),
    ...(previewUrl ? { previewUrl } : {}),
  });
  writeManifest();
  if (releaseMode === "direct-deploy") {
    output("release.direct_deploy_fallback", {
      status: "degraded",
      message:
        "Candidate metadata was incomplete; skipping preview verification and deploying directly",
    });
  }
  for (const step of productionReleaseSteps(releaseMode)) {
    if (step === "verify-candidate") {
      run("node", ["scripts/verify-deployment.mjs", previewUrl]);
    } else if (step === "capture-bookmark") {
      captureD1Bookmark();
    } else if (step === "migrate-production") {
      migrateProduction();
    } else if (step === "verify-migrations") {
      verifyProductionMigrations();
    } else if (step === "deploy-direct") {
      run("pnpm", ["exec", "wrangler", "deploy", "--env", ""]);
    } else if (step === "promote-version") {
      run("pnpm", [
        "exec",
        "wrangler",
        "versions",
        "deploy",
        `${workerVersionId}@100%`,
        "--env",
        "",
        "--yes",
        "--message",
        `Promote UniMailbox ${manifest.commit}`,
      ]);
    }
  }
  Object.assign(manifest, {
    promoted: true,
    verificationSkipped: releaseMode === "direct-deploy",
    promotedAt: new Date().toISOString(),
  });
  writeManifest();
}
output("release.completed", { status: "ok", ...manifest });
