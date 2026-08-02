#!/usr/bin/env node
import { resolve } from "node:path";
import {
  capture,
  fail,
  output,
  root,
  run,
  withSecureTemporaryJson,
} from "./_shared.mjs";
import { reconcileRuntimeSecretNames } from "./bootstrap-lib.mjs";
import { parseRuntimeSecretList } from "./release-lib.mjs";

const wranglerArgs = (args) => [
  "exec",
  "wrangler",
  "--config",
  "wrangler.jsonc",
  ...args,
];

function inspectRuntimeSecrets() {
  const result = capture(
    "pnpm",
    wranglerArgs(["secret", "list", "--env", "", "--format", "json"]),
  );
  if (!result.ok) {
    fail(
      "deployment.bootstrap.secret_state_failed",
      "Wrangler could not inspect Worker secrets; run pnpm deploy first to provision Cloudflare",
      5,
      { stderrBytes: Buffer.byteLength(result.stderr) },
    );
  }
  try {
    return parseRuntimeSecretList(result.stdout);
  } catch {
    fail(
      "deployment.bootstrap.secret_state_invalid",
      "Wrangler returned an invalid Worker secret list",
      5,
    );
  }
}

output("deployment.bootstrap.started", { status: "running" });

const forceAdministratorPasswordReset = process.argv
  .slice(2)
  .includes("--force-admin-password-reset");

const generatedSecrets = reconcileRuntimeSecretNames(inspectRuntimeSecrets());
const runtimeSecretsCreated = Object.keys(generatedSecrets);
const git = capture("git", ["rev-parse", "HEAD"]);
const confirmation = git.ok ? git.stdout : "initial-bootstrap";

run("node", [
  "scripts/migration.mjs",
  "migrate",
  "--target",
  "production",
  "--confirm",
  confirmation,
]);
run("node", [
  "scripts/bootstrap-admin.mjs",
  "--target",
  "production",
  ...(forceAdministratorPasswordReset ? ["--force-admin-password-reset"] : []),
]);

if (runtimeSecretsCreated.length > 0) {
  await withSecureTemporaryJson(
    resolve(root, ".wrangler", "deployment-bootstrap"),
    generatedSecrets,
    (path) =>
      run(
        "pnpm",
        wranglerArgs(["deploy", "--env", "", "--secrets-file", path]),
      ),
  );
}

output("deployment.bootstrap.completed", {
  status: "ok",
  migrationsApplied: true,
  administratorBootstrapped: true,
  runtimeSecretsCreated,
  verificationSkipped: true,
  next: "Confirm login and health, then adopt the installation before verified releases",
});
