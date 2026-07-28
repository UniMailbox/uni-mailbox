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
  if (!wrangler.stdout.includes("4.114.0")) {
    fail(
      "doctor.version_mismatch",
      `Expected pinned Wrangler 4.114.0; found ${wrangler.stdout}`,
      5,
    );
  }

  const wranglerConfig = readJsonc("wrangler.jsonc");
  const r2TopLevel = wranglerConfig.r2_buckets?.some(
    (binding) => binding.binding === "ATTACHMENTS",
  );
  const r2InEnv = Object.values(wranglerConfig.env ?? {}).some((entry) =>
    entry.r2_buckets?.some((binding) => binding.binding === "ATTACHMENTS"),
  );
  const storageBackend = r2TopLevel || r2InEnv ? "r2" : "kv";
  const storageReason = r2TopLevel
    ? "ATTACHMENTS binding is declared in wrangler.jsonc (top level)"
    : r2InEnv
      ? "ATTACHMENTS binding is declared in an env.* block of wrangler.jsonc"
      : "ATTACHMENTS binding is absent from wrangler.jsonc; KV is the default storage backend";
  const bindingChecks = {
    workerEntrypoint: wranglerConfig.main === "apps/worker/src/index.ts",
    assets: wranglerConfig.assets?.directory === "apps/web/dist",
    d1: wranglerConfig.d1_databases?.some(
      (binding) => binding.binding === "DB",
    ),
    kv: wranglerConfig.kv_namespaces?.some(
      (binding) => binding.binding === "KV",
    ),
    r2Optional: storageBackend === "r2",
    queue: wranglerConfig.queues?.producers?.some(
      (binding) => binding.binding === "OUTBOUND_QUEUE",
    ),
    runtimeSecretsManagedByRelease:
      wranglerConfig.secrets_store_secrets === undefined,
    crons: wranglerConfig.triggers?.crons?.length >= 3,
  };
  if (
    !bindingChecks.workerEntrypoint ||
    !bindingChecks.assets ||
    !bindingChecks.d1 ||
    !bindingChecks.kv ||
    !bindingChecks.queue ||
    !bindingChecks.runtimeSecretsManagedByRelease ||
    !bindingChecks.crons
  ) {
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
  const migrations = assertMigrationSet();
  output("doctor.completed", {
    status: "ok",
    node: process.versions.node,
    pnpm: pnpm.stdout,
    wrangler: wrangler.stdout,
    migrations,
    bindingChecks,
    storage: {
      backend: storageBackend,
      reason: storageReason,
    },
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
