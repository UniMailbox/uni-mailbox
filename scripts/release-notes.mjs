#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import packageMetadata from "../package.json" with { type: "json" };
import { capture, fail, output } from "./_shared.mjs";
import {
  buildReleaseNotes,
  changedFilesGitArgs,
} from "./release-notes-lib.mjs";

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const tag = option("--tag");
const baseFile = option("--base-file");
const outputFile = option("--output");
if (!tag || !baseFile || !outputFile || tag !== `v${packageMetadata.version}`) {
  fail(
    "release_notes.usage",
    "Usage: release-notes.mjs --tag v<package-version> --base-file <path> --output <path>",
    2,
  );
}
const previous = capture("git", [
  "describe",
  "--tags",
  "--abbrev=0",
  `${tag}^`,
]);
const migrationDiff = capture(
  "git",
  changedFilesGitArgs({
    tag,
    previousTag: previous.ok ? previous.stdout : undefined,
    pathspecs: ["migrations"],
  }),
);
if (!migrationDiff.ok) {
  fail(
    "release_notes.migration_diff_failed",
    "Could not inspect release migrations",
    3,
  );
}
const migrations = migrationDiff.stdout
  .split(/\r?\n/u)
  .filter((file) => /^migrations\/\d{4}_[^/]+\.sql$/u.test(file));
const changedFilesResult = capture(
  "git",
  changedFilesGitArgs({
    tag,
    previousTag: previous.ok ? previous.stdout : undefined,
  }),
);
if (!changedFilesResult.ok) {
  fail(
    "release_notes.change_diff_failed",
    "Could not inspect release changes",
    3,
  );
}
const changedOperationalFiles = changedFilesResult.stdout
  .split(/\r?\n/u)
  .filter((file) =>
    /^(?:wrangler(?:\.r2)?\.jsonc|package\.json|\.dev\.vars\.example|\.github\/)/u.test(
      file,
    ),
  );
const notes = buildReleaseNotes({
  version: packageMetadata.version,
  changeSummary: readFileSync(baseFile, "utf8"),
  migrations,
  nodeVersion: packageMetadata.engines.node,
  packageManager: packageMetadata.packageManager,
  wranglerVersion: packageMetadata.devDependencies.wrangler,
  minimumSourceVersion: previous.ok ? previous.stdout.replace(/^v/u, "") : null,
  changedOperationalFiles,
});
writeFileSync(outputFile, notes);
output("release_notes.completed", {
  status: "ok",
  version: packageMetadata.version,
  migrationCount: migrations.length,
});
