export function buildReleaseNotes({
  version,
  changeSummary,
  migrations,
  nodeVersion,
  packageManager,
  wranglerVersion,
  minimumSourceVersion,
  changedOperationalFiles,
}) {
  const pnpmVersion = packageManager.replace(/^pnpm@/u, "");
  const migrationNotes =
    migrations.length > 0
      ? migrations.map((migration) => `- \`${migration}\``).join("\n")
      : "No new D1 migrations are included in this release.";
  const operationalChanges =
    changedOperationalFiles.length > 0
      ? changedOperationalFiles.map((file) => `- \`${file}\``).join("\n")
      : "No binding, permission, secret, workflow, or package configuration files changed.";
  const hasBreakingChanges = /\bBREAKING(?:[ -]CHANGE)?\b/iu.test(
    changeSummary,
  );
  return [
    `# UniMailbox v${version}`,
    "",
    changeSummary.trim(),
    "",
    "## D1 migrations",
    "",
    migrationNotes,
    "",
    "## Compatibility boundary",
    "",
    minimumSourceVersion
      ? `Minimum source version: \`${minimumSourceVersion}\`.`
      : "This is the initial stable release; there is no earlier supported source version.",
    hasBreakingChanges
      ? "Breaking changes are present in the change summary above; follow their operator instructions before deployment."
      : "No breaking change marker was detected in the generated change summary.",
    "",
    "## Minimum toolchain",
    "",
    `- Node ${nodeVersion}`,
    `- pnpm ${pnpmVersion}`,
    `- Wrangler ${wranglerVersion}`,
    "",
    "## Binding, permission, secret, and workflow changes",
    "",
    operationalChanges,
    "",
    "## Upgrade notes",
    "",
    "Installation maintainers should review the upgrade PR, its structured configuration diff, and any operator actions in the change summary; resolve local conflicts, merge it to `main`, and then manually approve the `production` Environment deployment. Database migrations are fix-forward; only the Worker is rolled back automatically after a failed post-deploy smoke test. Known compatibility limits are maintained in `docs/compatibility.md`.",
    "",
  ].join("\n");
}

export function changedFilesGitArgs({ tag, previousTag, pathspecs = [] }) {
  const separator = pathspecs.length > 0 ? ["--", ...pathspecs] : [];
  return previousTag
    ? ["diff", "--name-only", `${previousTag}..${tag}`, ...separator]
    : ["ls-tree", "-r", "--name-only", tag, ...separator];
}
