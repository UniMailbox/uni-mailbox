#!/usr/bin/env node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { capture, output, parseJsonc, readJson, root } from "./_shared.mjs";
import {
  isOfficialRepository,
  mergeInstallationPackage,
  mergeInstallationWrangler,
} from "./deployment-lib.mjs";
import {
  buildUpgradePrBody,
  parseConflictPaths,
  parseGitHubRepository,
  parseJsonOutput,
  selectStableUpgrade,
} from "./deployment-cli-lib.mjs";

const STRUCTURED_FILES = new Set([
  "package.json",
  "wrangler.jsonc",
  "wrangler.r2.jsonc",
  ".unimailbox/installation.json",
  ".unimailbox/upstream.json",
]);

class CompletedSync extends Error {}

function command(commandName, args, options = {}) {
  return capture(commandName, args, { cwd: root, ...options });
}

function requireCommand(commandName, args, label, options = {}) {
  const result = command(commandName, args, options);
  if (!result.ok) throw new Error(`${label} failed`);
  return result.stdout;
}

function git(args, label, options = {}) {
  return requireCommand("git", args, label, options);
}

function gitAt(reference, path) {
  return git(
    ["show", `${reference}:${path}`],
    `reading ${path} at ${reference}`,
  );
}

function githubRepository() {
  if (process.env.GITHUB_REPOSITORY) {
    return parseGitHubRepository(process.env.GITHUB_REPOSITORY);
  }
  return parseGitHubRepository(
    requireCommand(
      "gh",
      ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"],
      "repository lookup",
    ),
  );
}

function githubJson(args, label) {
  return parseJsonOutput(requireCommand("gh", args, label), label);
}

function updateIndexFile(indexEnvironment, path, value) {
  const blob = git(["hash-object", "-w", "--stdin"], `hashing ${path}`, {
    env: indexEnvironment,
    input: `${value.endsWith("\n") ? value : `${value}\n`}`,
  });
  git(
    ["update-index", "--add", "--cacheinfo", "100644", blob, path],
    `updating ${path}`,
    { env: indexEnvironment },
  );
}

function changedPaths(base, next, pathspecs) {
  const result = git(
    ["diff", "--name-only", base, next, "--", ...pathspecs],
    "upstream change lookup",
  );
  return result ? result.split("\n").filter(Boolean) : [];
}

function createOrUpdateConflictIssue({
  repository,
  fromTag,
  toTag,
  conflicts,
  distributionRepository,
}) {
  const title = `Upstream upgrade conflict: ${toTag}`;
  const body = `The daily UniMailbox stable upgrade could not merge ${fromTag} → ${toTag}.

No change was made to \`main\`, and no deployment was started.

### Conflicted files

${conflicts.map((path) => `- \`${path}\``).join("\n")}

### Manual reproduction

\`\`\`bash
git fetch https://github.com/${distributionRepository}.git refs/tags/${fromTag}:refs/unimailbox/upstream/${fromTag} refs/tags/${toTag}:refs/unimailbox/upstream/${toTag}
git switch main
git switch -c automation/upstream-${toTag}
git diff --binary refs/unimailbox/upstream/${fromTag} refs/unimailbox/upstream/${toTag} | git apply --3way --index
\`\`\`

Resolve only the listed conflicts, run the repository validation suite, and open an upgrade PR. Installation-specific resource identifiers must remain unchanged.
`;
  const existing = command("gh", [
    "issue",
    "list",
    "--repo",
    repository,
    "--state",
    "open",
    "--search",
    `${title} in:title`,
    "--json",
    "number",
    "--jq",
    ".[0].number",
  ]);
  if (!existing.ok) throw new Error("conflict issue lookup failed");
  if (existing.stdout) {
    requireCommand(
      "gh",
      [
        "issue",
        "edit",
        existing.stdout,
        "--repo",
        repository,
        "--title",
        title,
        "--body",
        body,
      ],
      "conflict issue update",
    );
  } else {
    requireCommand(
      "gh",
      [
        "issue",
        "create",
        "--repo",
        repository,
        "--title",
        title,
        "--body",
        body,
      ],
      "conflict issue creation",
    );
  }
}

function validateUpgrade(worktree) {
  const validations = [
    [
      "pnpm install --frozen-lockfile",
      "pnpm",
      ["install", "--frozen-lockfile"],
    ],
    ["pnpm config:check", "pnpm", ["config:check"]],
    ["pnpm scaffold doctor --ci", "pnpm", ["scaffold", "doctor", "--ci"]],
    [
      "pnpm db:migration:status --target local",
      "pnpm",
      ["db:migration:status", "--target", "local"],
    ],
    ["pnpm typecheck", "pnpm", ["typecheck"]],
    ["pnpm test", "pnpm", ["test"]],
    ["pnpm deploy:dry-run", "pnpm", ["deploy:dry-run"]],
  ];
  const completed = [];
  for (const [label, executable, args] of validations) {
    output("upstream_sync.validation.started", { validation: label });
    const result = spawnSync(executable, args, {
      cwd: worktree,
      env: process.env,
      stdio: "inherit",
    });
    if (result.error || result.status !== 0) {
      throw new Error(`${label} failed`);
    }
    completed.push(`${label}: passed`);
  }
  return completed;
}

function createCommit(tree, parent, version) {
  const identity = {
    GIT_AUTHOR_NAME: "UniMailbox Updater",
    GIT_AUTHOR_EMAIL: "github-actions[bot]@users.noreply.github.com",
    GIT_COMMITTER_NAME: "UniMailbox Updater",
    GIT_COMMITTER_EMAIL: "github-actions[bot]@users.noreply.github.com",
  };
  return git(
    [
      "commit-tree",
      tree,
      "-p",
      parent,
      "-m",
      `chore: upgrade UniMailbox to ${version}`,
    ],
    "upgrade commit creation",
    { env: { ...process.env, ...identity } },
  );
}

function pushAndOpenPr({ repository, branch, commit, title, body }) {
  const remoteBranchRef = `refs/heads/${branch}`;
  const remoteBranch = command("git", ["ls-remote", "origin", remoteBranchRef]);
  if (!remoteBranch.ok) throw new Error("automation branch lookup failed");
  const expectedRemoteCommit = remoteBranch.stdout
    ? remoteBranch.stdout.split(/\s/u)[0]
    : "";
  git(
    [
      "push",
      `--force-with-lease=${remoteBranchRef}:${expectedRemoteCommit}`,
      "origin",
      `${commit}:${remoteBranchRef}`,
    ],
    "automation branch push",
  );
  const existing = command("gh", [
    "pr",
    "list",
    "--repo",
    repository,
    "--head",
    branch,
    "--base",
    "main",
    "--state",
    "open",
    "--json",
    "number,url",
    "--jq",
    ".[0].number",
  ]);
  if (!existing.ok) throw new Error("upgrade PR lookup failed");
  if (existing.stdout) {
    requireCommand(
      "gh",
      [
        "pr",
        "edit",
        existing.stdout,
        "--repo",
        repository,
        "--title",
        title,
        "--body",
        body,
      ],
      "upgrade PR update",
    );
  } else {
    requireCommand(
      "gh",
      [
        "pr",
        "create",
        "--repo",
        repository,
        "--head",
        branch,
        "--base",
        "main",
        "--title",
        title,
        "--body",
        body,
      ],
      "upgrade PR creation",
    );
  }
}

let temporaryRoot;
let validationWorktree;
try {
  const repository = githubRepository();
  if (isOfficialRepository(repository)) {
    output("upstream_sync.skipped", {
      status: "skipped",
      reason: "official_repository",
      repository,
    });
    throw new CompletedSync();
  }
  if (git(["status", "--porcelain"], "worktree status") !== "") {
    throw new Error("upstream sync requires a clean worktree");
  }
  const currentCommit = git(["rev-parse", "HEAD"], "current commit lookup");
  const remoteMain = git(
    ["ls-remote", "--exit-code", "origin", "refs/heads/main"],
    "remote main lookup",
  ).split(/\s/u)[0];
  if (currentCommit !== remoteMain) {
    throw new Error("upstream sync requires the exact remote main HEAD");
  }
  if (process.env.GITHUB_REF && process.env.GITHUB_REF !== "refs/heads/main") {
    throw new Error("upstream sync is allowed only from main");
  }

  const installation = readJson(".unimailbox/installation.json");
  if (installation.repository !== repository) {
    throw new Error("installation manifest belongs to a different repository");
  }
  const distributionRepository = installation.upstream?.distributionRepository;
  const sourceRepository = installation.upstream?.sourceRepository;
  const configuredDistributionRepository =
    process.env.UNIMAILBOX_DISTRIBUTION_REPOSITORY ??
    "UniMailbox/unimailbox-deploy";
  const configuredSourceRepository =
    process.env.UNIMAILBOX_SOURCE_REPOSITORY ?? "UniMailbox/uni-mailbox";
  const configuredChannel = process.env.UNIMAILBOX_UPDATE_CHANNEL ?? "stable";
  if (
    configuredDistributionRepository !== "UniMailbox/unimailbox-deploy" ||
    distributionRepository !== configuredDistributionRepository
  ) {
    throw new Error("installation does not track the official distribution");
  }
  if (
    configuredSourceRepository !== "UniMailbox/uni-mailbox" ||
    sourceRepository !== configuredSourceRepository
  ) {
    throw new Error(
      "installation does not track the official source repository",
    );
  }
  if (
    configuredChannel !== "stable" ||
    installation.upstream.channel !== "stable"
  ) {
    throw new Error("upstream sync supports only the stable channel");
  }
  const release = githubJson(
    ["api", `repos/${sourceRepository}/releases/latest`],
    "latest stable release lookup",
  );
  if (release.tag_name === installation.upstream.tag) {
    output("upstream_sync.completed", {
      status: "up_to_date",
      version: installation.upstream.version,
    });
    throw new CompletedSync();
  }
  const upgrade = selectStableUpgrade({
    currentVersion: installation.upstream.version,
    release,
  });
  const fromTag = installation.upstream.tag;
  const remote = `https://github.com/${distributionRepository}.git`;
  for (const tag of [fromTag, upgrade.tag]) {
    git(
      [
        "fetch",
        "--no-tags",
        remote,
        `refs/tags/${tag}:refs/unimailbox/upstream/${tag}`,
      ],
      `fetching ${tag}`,
    );
  }
  const base = git(
    ["rev-parse", `refs/unimailbox/upstream/${fromTag}^{commit}`],
    "base tag resolution",
  );
  const next = git(
    ["rev-parse", `refs/unimailbox/upstream/${upgrade.tag}^{commit}`],
    "upgrade tag resolution",
  );
  const nextUpstream = parseJsonOutput(
    gitAt(next, ".unimailbox/upstream.json"),
    "upstream manifest",
  );
  if (
    nextUpstream.schemaVersion !== 1 ||
    nextUpstream.channel !== "stable" ||
    nextUpstream.sourceRepository !== "UniMailbox/uni-mailbox" ||
    nextUpstream.distributionRepository !== distributionRepository ||
    nextUpstream.version !== upgrade.version ||
    nextUpstream.tag !== upgrade.tag
  ) {
    throw new Error("release tag contains an inconsistent upstream manifest");
  }
  const baseUpstream = parseJsonOutput(
    gitAt(base, ".unimailbox/upstream.json"),
    "baseline upstream manifest",
  );
  for (const field of [
    "schemaVersion",
    "sourceRepository",
    "distributionRepository",
    "channel",
    "version",
    "tag",
    "sourceCommit",
  ]) {
    if (baseUpstream[field] !== installation.upstream[field]) {
      throw new Error(
        `installation baseline does not match ${fromTag} (${field})`,
      );
    }
  }

  temporaryRoot = mkdtempSync(resolve(tmpdir(), "unimailbox-sync-"));
  const indexPath = resolve(temporaryRoot, "merge-index");
  const indexEnvironment = { ...process.env, GIT_INDEX_FILE: indexPath };
  git(
    ["read-tree", "-m", "-i", base, currentCommit, next],
    "three-way upstream merge",
    { env: indexEnvironment },
  );

  const currentPackage = parseJsonOutput(
    gitAt(currentCommit, "package.json"),
    "installation package.json",
  );
  const nextPackage = parseJsonOutput(
    gitAt(next, "package.json"),
    "upstream package.json",
  );
  updateIndexFile(
    indexEnvironment,
    "package.json",
    `${JSON.stringify(
      mergeInstallationPackage({
        current: currentPackage,
        upstream: nextPackage,
      }),
      null,
      2,
    )}\n`,
  );
  for (const path of ["wrangler.jsonc", "wrangler.r2.jsonc"]) {
    const currentConfig = parseJsonc(gitAt(currentCommit, path));
    const nextConfig = parseJsonc(gitAt(next, path));
    updateIndexFile(
      indexEnvironment,
      path,
      `${JSON.stringify(
        mergeInstallationWrangler({
          current: currentConfig,
          upstream: nextConfig,
        }),
        null,
        2,
      )}\n`,
    );
  }
  updateIndexFile(
    indexEnvironment,
    ".unimailbox/installation.json",
    `${JSON.stringify({ ...installation, upstream: nextUpstream }, null, 2)}\n`,
  );
  updateIndexFile(
    indexEnvironment,
    ".unimailbox/upstream.json",
    `${JSON.stringify(nextUpstream, null, 2)}\n`,
  );

  const unmerged = command("git", ["ls-files", "-u"], {
    env: indexEnvironment,
  });
  if (!unmerged.ok) throw new Error("conflict lookup failed");
  const conflicts = parseConflictPaths(unmerged.stdout).filter(
    (path) => !STRUCTURED_FILES.has(path),
  );
  if (conflicts.length > 0) {
    createOrUpdateConflictIssue({
      repository,
      fromTag,
      toTag: upgrade.tag,
      conflicts,
      distributionRepository,
    });
    output("upstream_sync.conflict", {
      status: "conflict",
      fromVersion: installation.upstream.version,
      toVersion: upgrade.version,
      conflicts,
      mainChanged: false,
      deploymentStarted: false,
    });
    throw new CompletedSync();
  }

  const tree = git(["write-tree"], "merged tree creation", {
    env: indexEnvironment,
  });
  const commit = createCommit(tree, currentCommit, upgrade.version);
  validationWorktree = resolve(temporaryRoot, "validation-worktree");
  git(
    ["worktree", "add", "--detach", validationWorktree, commit],
    "validation worktree creation",
  );
  const validation = validateUpgrade(validationWorktree);
  git(
    ["worktree", "remove", "--force", validationWorktree],
    "validation worktree removal",
  );
  validationWorktree = undefined;

  const migrations = changedPaths(base, next, ["migrations"]).filter((path) =>
    /^migrations\/\d{4}_[^/]+\.sql$/u.test(path),
  );
  const configurationChanges = changedPaths(base, next, [
    "package.json",
    "wrangler.jsonc",
    "wrangler.r2.jsonc",
    ".github/workflows",
  ]);
  const branch = `automation/upstream-${upgrade.tag}`;
  const title = `chore: upgrade UniMailbox to ${upgrade.version}`;
  const body = buildUpgradePrBody({
    fromVersion: installation.upstream.version,
    toVersion: upgrade.version,
    releaseUrl: upgrade.releaseUrl,
    releaseNotes: upgrade.releaseNotes,
    migrations,
    configurationChanges,
    validation,
  });
  pushAndOpenPr({ repository, branch, commit, title, body });
  output("upstream_sync.completed", {
    status: "pull_request_ready",
    fromVersion: installation.upstream.version,
    toVersion: upgrade.version,
    branch,
    mainChanged: false,
    deploymentStarted: false,
  });
} catch (error) {
  if (!(error instanceof CompletedSync)) {
    if (validationWorktree) {
      command("git", ["worktree", "remove", "--force", validationWorktree]);
      validationWorktree = undefined;
    }
    output("upstream_sync.failed", {
      status: "failed",
      message: error instanceof Error ? error.message : "Upstream sync failed",
    });
    process.exitCode = 2;
  }
} finally {
  if (temporaryRoot) rmSync(temporaryRoot, { recursive: true, force: true });
}
