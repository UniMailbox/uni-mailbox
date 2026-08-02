import { describe, expect, it } from "vitest";
import {
  buildReleaseNotes,
  changedFilesGitArgs,
} from "./release-notes-lib.mjs";

describe("release notes", () => {
  it("includes compatibility requirements, migrations, and upgrade notes", () => {
    const notes = buildReleaseNotes({
      version: "0.2.0",
      changeSummary: "## Features\n\n* Add stable updates.",
      migrations: ["migrations/0005_stable_updates.sql"],
      nodeVersion: ">=22.0.0",
      packageManager: "pnpm@10.32.1",
      wranglerVersion: "4.114.0",
      minimumSourceVersion: "0.1.0",
      changedOperationalFiles: [
        "wrangler.jsonc",
        ".github/workflows/release.yml",
      ],
    });
    expect(notes).toContain("UniMailbox v0.2.0");
    expect(notes).toContain("migrations/0005_stable_updates.sql");
    expect(notes).toContain("Node >=22.0.0");
    expect(notes).toContain("pnpm 10.32.1");
    expect(notes).toContain("Wrangler 4.114.0");
    expect(notes).toContain("review the upgrade PR");
    expect(notes).toContain("Minimum source version: `0.1.0`");
    expect(notes).toContain("`wrangler.jsonc`");
    expect(notes).toContain("No breaking change marker was detected");
  });

  it("makes an empty migration set explicit", () => {
    expect(
      buildReleaseNotes({
        version: "0.1.0",
        changeSummary: "Initial release.",
        migrations: [],
        nodeVersion: ">=22",
        packageManager: "pnpm@10",
        wranglerVersion: "4",
        minimumSourceVersion: null,
        changedOperationalFiles: [],
      }),
    ).toContain("No new D1 migrations");
  });

  it("surfaces a breaking change marker from the generated summary", () => {
    expect(
      buildReleaseNotes({
        version: "1.0.0",
        changeSummary: "BREAKING CHANGE: replace the storage contract",
        migrations: [],
        nodeVersion: ">=22",
        packageManager: "pnpm@10",
        wranglerVersion: "4",
        minimumSourceVersion: "0.9.0",
        changedOperationalFiles: [],
      }),
    ).toContain("Breaking changes are present in the change summary above");
  });

  it("enumerates the full tag for an initial release and diffs later releases", () => {
    expect(
      changedFilesGitArgs({ tag: "v0.1.0", pathspecs: ["migrations"] }),
    ).toEqual(["ls-tree", "-r", "--name-only", "v0.1.0", "--", "migrations"]);
    expect(
      changedFilesGitArgs({
        tag: "v0.2.0",
        previousTag: "v0.1.0",
        pathspecs: ["migrations"],
      }),
    ).toEqual(["diff", "--name-only", "v0.1.0..v0.2.0", "--", "migrations"]);
  });
});
