#!/usr/bin/env node
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  capture,
  fail,
  output,
  readJson,
  readJsonc,
  root,
} from "./_shared.mjs";
import {
  assertProductionRepository,
  createInstallationManifest,
} from "./deployment-lib.mjs";
import {
  parseGitHubRepository,
  parseJsonOutput,
  validateProductionEnvironment,
} from "./deployment-cli-lib.mjs";

function githubApi(repository, endpoint, label) {
  const result = capture("gh", [
    "api",
    `repos/${repository}/${endpoint}`,
    "--header",
    "X-GitHub-Api-Version: 2022-11-28",
  ]);
  if (!result.ok) throw new Error(`Could not read ${label} from GitHub`);
  return parseJsonOutput(result.stdout, label);
}

function currentRepository() {
  if (process.env.GITHUB_REPOSITORY) {
    return parseGitHubRepository(process.env.GITHUB_REPOSITORY);
  }
  const result = capture("gh", [
    "repo",
    "view",
    "--json",
    "nameWithOwner",
    "--jq",
    ".nameWithOwner",
  ]);
  if (!result.ok) {
    throw new Error(
      "Could not determine the GitHub repository; authenticate gh",
    );
  }
  return parseGitHubRepository(result.stdout);
}

function writeManifest(manifest) {
  const directory = resolve(root, ".unimailbox");
  mkdirSync(directory, { recursive: true });
  const target = resolve(directory, "installation.json");
  const temporary = resolve(directory, `.installation-${randomUUID()}.tmp`);
  writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: 0o600,
    flag: "wx",
  });
  renameSync(temporary, target);
}

try {
  const adminBypassConfirmed = process.argv.includes(
    "--confirm-admin-bypass-disabled",
  );
  const repository = currentRepository();
  assertProductionRepository(repository);

  const baseEndpoint = "environments/production";
  const environment = githubApi(
    repository,
    baseEndpoint,
    "production Environment",
  );
  const branchPolicyResponse = githubApi(
    repository,
    `${baseEndpoint}/deployment-branch-policies?per_page=100`,
    "production deployment branch policies",
  );
  const variableResponse = githubApi(
    repository,
    `${baseEndpoint}/variables?per_page=100`,
    "production Environment variables",
  );
  const secretResponse = githubApi(
    repository,
    `${baseEndpoint}/secrets?per_page=100`,
    "production Environment secrets",
  );
  const environmentResult = validateProductionEnvironment({
    environment,
    branchPolicies: branchPolicyResponse.branch_policies,
    variables: variableResponse.variables,
    secrets: secretResponse.secrets,
    adminBypassConfirmed,
  });

  const upstream = readJson(".unimailbox/upstream.json");
  const packageMetadata = readJson("package.json");
  if (upstream.distributionRepository !== "UniMailbox/unimailbox-deploy") {
    throw new Error("upstream manifest is not from the official distribution");
  }
  if (
    upstream.version !== packageMetadata.version ||
    upstream.tag !== `v${packageMetadata.version}`
  ) {
    throw new Error("upstream manifest does not match the application version");
  }
  const wrangler = readJsonc("wrangler.jsonc");
  const adoptR2 = process.argv.includes("--r2");
  const r2Path = resolve(root, "wrangler.r2.jsonc");
  if (adoptR2 && !existsSync(r2Path)) {
    throw new Error("--r2 requires wrangler.r2.jsonc");
  }
  const r2Wrangler = adoptR2 ? readJsonc("wrangler.r2.jsonc") : undefined;
  const manifest = {
    ...createInstallationManifest({
      wrangler,
      r2Wrangler,
      upstream,
      repository,
      deploymentUrl: environmentResult.deploymentUrl,
    }),
    productionEnvironment: {
      name: "production",
      branch: "main",
      requiredReviewer: true,
      preventSelfReview: true,
      adminBypassDisabled: true,
      adminBypassVerification: environmentResult.adminBypassVerification,
    },
  };
  writeManifest(manifest);
  output("deployment.adoption.completed", {
    status: "ok",
    repository,
    manifest: ".unimailbox/installation.json",
    deploymentUrl: manifest.deploymentUrl,
  });
} catch (error) {
  fail(
    "deployment.adoption.failed",
    error instanceof Error ? error.message : "Adoption failed",
    2,
  );
}
