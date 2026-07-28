#!/usr/bin/env node
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertMigrationSet,
  capture,
  fail,
  output,
  readJson,
  readJsonc,
  root,
  run,
} from "./_shared.mjs";

const command = process.argv[2];

function assertVersion(label, actual, expectedPrefix) {
  if (!actual.startsWith(expectedPrefix)) {
    fail(
      "doctor.version_mismatch",
      `${label} ${expectedPrefix} is required; found ${actual}`,
      5,
      { label, actual, expected: expectedPrefix },
    );
  }
}

function doctor() {
  const pkg = readJson("package.json");
  assertVersion("Node", process.versions.node, "22.");
  const pnpm = capture("pnpm", ["--version"]);
  if (!pnpm.ok) fail("doctor.tool_missing", "pnpm is not available", 5);
  assertVersion("pnpm", pnpm.stdout, "10.");
  const wrangler = capture("pnpm", ["exec", "wrangler", "--version"]);
  if (!wrangler.ok) fail("doctor.tool_missing", "Wrangler is not available", 5);
  if (!wrangler.stdout.includes("4.68.0")) {
    fail(
      "doctor.version_mismatch",
      `Expected pinned Wrangler 4.68.0; found ${wrangler.stdout}`,
      5,
    );
  }

  const wranglerConfig = readJsonc("wrangler.jsonc");
  const bindingChecks = {
    workerEntrypoint: wranglerConfig.main === "apps/worker/src/index.ts",
    assets: wranglerConfig.assets?.directory === "apps/web/dist",
    d1: wranglerConfig.d1_databases?.some(
      (binding) => binding.binding === "DB",
    ),
    kv: wranglerConfig.kv_namespaces?.some(
      (binding) => binding.binding === "KV",
    ),
    r2: wranglerConfig.r2_buckets?.some(
      (binding) => binding.binding === "ATTACHMENTS",
    ),
    queue: wranglerConfig.queues?.producers?.some(
      (binding) => binding.binding === "OUTBOUND_QUEUE",
    ),
    secrets: wranglerConfig.secrets_store_secrets?.length === 3,
    crons: wranglerConfig.triggers?.crons?.length >= 3,
  };
  if (Object.values(bindingChecks).some((value) => !value)) {
    fail(
      "doctor.wrangler_config_invalid",
      "One or more root deployment bindings are missing",
      6,
      { bindingChecks },
    );
  }
  const requiredScripts = [
    "build",
    "typecheck",
    "schema:check",
    "test",
    "scaffold",
    "db:migrate",
    "db:verify",
    "release:preview",
    "release:production",
    "release:rollback",
    "release:verify",
  ];
  const missingScripts = requiredScripts.filter((name) => !pkg.scripts?.[name]);
  if (missingScripts.length) {
    fail("doctor.scripts_missing", "Required scripts are missing", 6, {
      missingScripts,
    });
  }
  const bindings = pkg.cloudflare?.bindings ?? {};
  const missingSecrets = [
    "INSTALLATION_TOKEN",
    "AUTH_SIGNING_KEY",
    "CREDENTIAL_ENCRYPTION_KEY",
  ].filter((name) => !bindings[name]);
  if (missingSecrets.length) {
    fail(
      "doctor.secret_metadata_missing",
      "Secret descriptions are missing",
      6,
      {
        missingSecrets,
      },
    );
  }
  const migrations = assertMigrationSet();
  output("doctor.completed", {
    status: "ok",
    node: process.versions.node,
    pnpm: pnpm.stdout,
    wrangler: wrangler.stdout,
    migrations,
    bindingChecks,
  });
}

if (command === "doctor") {
  doctor();
} else if (command === "init") {
  mkdirSync(resolve(root, ".wrangler", "state"), { recursive: true });
  doctor();
  run("node", ["scripts/migration.mjs", "migrate", "--target", "local"]);
  run("node", ["scripts/migration.mjs", "verify", "--target", "local"]);
  output("scaffold.init.completed", { status: "ok" });
} else {
  fail("scaffold.usage", "Usage: pnpm scaffold init|doctor", 2);
}
