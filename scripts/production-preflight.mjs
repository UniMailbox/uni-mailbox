#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  capture,
  fail,
  output,
  readJson,
  readJsonc,
  root,
} from "./_shared.mjs";
import {
  assertInstallationMatchesConfig,
  assertProductionRepository,
  validateProductionSource,
} from "./deployment-lib.mjs";
import {
  assertDeploymentCredentials,
  parseGitHubRepository,
  parseJsonOutput,
  validateCloudflareResolution,
} from "./deployment-cli-lib.mjs";

function requireSuccessful(result, label) {
  if (!result.ok) throw new Error(`${label} failed`);
  return result.stdout;
}

function normalizeHttpsOrigin(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} is required`);
  }
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error(`${label} must use HTTPS`);
  return url.origin;
}

try {
  const repository = parseGitHubRepository(process.env.GITHUB_REPOSITORY);
  assertProductionRepository(repository);
  assertDeploymentCredentials(process.env);

  const manifest = readJson(".unimailbox/installation.json");
  const packageMetadata = readJson("package.json");
  if (manifest.repository !== repository) {
    throw new Error("installation manifest belongs to a different repository");
  }
  if (
    manifest.productionEnvironment?.name !== "production" ||
    manifest.productionEnvironment?.branch !== "main" ||
    manifest.productionEnvironment?.adminBypassDisabled !== true
  ) {
    throw new Error(
      "installation manifest lacks the production Environment adoption gate",
    );
  }
  if (
    manifest.upstream?.version !== packageMetadata.version ||
    manifest.upstream?.tag !== `v${packageMetadata.version}`
  ) {
    throw new Error(
      "installation upstream version does not match package.json",
    );
  }
  if (
    normalizeHttpsOrigin(process.env.DEPLOYMENT_URL, "DEPLOYMENT_URL") !==
    normalizeHttpsOrigin(manifest.deploymentUrl, "installation deployment URL")
  ) {
    throw new Error("DEPLOYMENT_URL does not match the adopted installation");
  }

  const remoteOutput = requireSuccessful(
    capture("git", ["ls-remote", "--exit-code", "origin", "refs/heads/main"]),
    "remote main lookup",
  );
  const remoteMainSha = remoteOutput.split(/\s/u)[0];
  validateProductionSource({
    ref: process.env.GITHUB_REF,
    sha: process.env.GITHUB_SHA,
    remoteMainSha,
  });
  const localSha = requireSuccessful(
    capture("git", ["rev-parse", "HEAD"]),
    "local HEAD lookup",
  );
  if (localSha !== process.env.GITHUB_SHA) {
    throw new Error("checked-out HEAD does not match GITHUB_SHA");
  }

  const wrangler = readJsonc("wrangler.jsonc");
  const adoptedR2 = manifest.resources?.r2 ?? [];
  const r2Path = resolve(root, "wrangler.r2.jsonc");
  if (adoptedR2.length > 0 && !existsSync(r2Path)) {
    throw new Error("adopted R2 configuration requires wrangler.r2.jsonc");
  }
  const r2Wrangler = existsSync(r2Path)
    ? readJsonc("wrangler.r2.jsonc")
    : undefined;
  assertInstallationMatchesConfig(manifest, wrangler, r2Wrangler);

  const versions = parseJsonOutput(
    requireSuccessful(
      capture("pnpm", [
        "exec",
        "wrangler",
        "versions",
        "list",
        "--config",
        "wrangler.jsonc",
        "--name",
        manifest.worker.name,
        "--json",
      ]),
      "Worker resolution",
    ),
    "Wrangler Worker resolution",
  );
  const d1 = parseJsonOutput(
    requireSuccessful(
      capture("pnpm", [
        "exec",
        "wrangler",
        "d1",
        "info",
        manifest.resources.d1.name,
        "--config",
        "wrangler.jsonc",
        "--json",
      ]),
      "D1 resolution",
    ),
    "Wrangler D1 resolution",
  );
  validateCloudflareResolution({ versions, d1, manifest });

  output("deployment.production_preflight.completed", {
    status: "ok",
    repository,
    sha: process.env.GITHUB_SHA,
    worker: manifest.worker.name,
    database: manifest.resources.d1.name,
  });
} catch (error) {
  fail(
    "deployment.production_preflight.failed",
    error instanceof Error ? error.message : "Production preflight failed",
    2,
  );
}
