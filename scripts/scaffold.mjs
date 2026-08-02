#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertMigrationSet,
  capture,
  fail,
  output,
  readJson,
  readJsonc,
  root as defaultRoot,
  run,
} from "./_shared.mjs";

// Tests need to point the script at a temporary copy of the repo. Honour an
// explicit override so the helper is the same code path used in production.
const root = process.env.UNIMAILBOX_SCAFFOLD_ROOT ?? defaultRoot;

const command = process.argv[2];

// `pnpm scaffold` (no subcommand) is a daily occurrence. Make it the friendly
// path so a curious contributor does not see a stack-trace-shaped `fail`.
const USAGE = {
  name: "scaffold",
  subcommands: ["init", "doctor"],
  examples: [
    "pnpm scaffold init    # one-shot local bootstrap (D1, KV, migrations)",
    "pnpm scaffold doctor  # verify the development environment only",
  ],
  notes: [
    "Every output is one JSON line; pipe through `jq` to inspect.",
    "Exit code 0 is success; 2-7 indicate a specific `doctor.*` failure mode.",
  ],
};

function printUsage() {
  process.stdout.write(`${USAGE.name} — local environment orchestrator\n\n`);
  process.stdout.write("USAGE\n  pnpm scaffold <subcommand>\n\n");
  process.stdout.write("SUBCOMMANDS\n");
  for (const name of USAGE.subcommands) {
    process.stdout.write(`  ${name.padEnd(10)} ${describeSubcommand(name)}\n`);
  }
  process.stdout.write(`  help       Show this help text\n`);
  process.stdout.write("\nEXAMPLES\n");
  for (const example of USAGE.examples) {
    process.stdout.write(`  ${example}\n`);
  }
  process.stdout.write("\nNOTES\n");
  for (const note of USAGE.notes) {
    process.stdout.write(`  - ${note}\n`);
  }
  process.stdout.write("\n");
}

function describeSubcommand(name) {
  switch (name) {
    case "init":
      return "Run doctor + apply D1 migrations to the local target";
    case "doctor":
      return "Verify toolchain, wrangler.jsonc, required scripts, migrations";
    default:
      return "";
  }
}

function assertExactVersion(label, actual, expected) {
  // Doctor used to accept any `10.x` pnpm or any wrangler whose banner happened
  // to contain the literal version string. Both checks pass on broken installs
  // and both fail with cryptic messages on working ones. Pin to the exact
  // value the project depends on.
  const trimmed = actual.trim();
  if (trimmed !== expected) {
    fail(
      "doctor.version_mismatch",
      `${label} ${expected} is required; found ${trimmed || "(empty)"}`,
      5,
      { label, actual: trimmed, expected },
    );
  }
}

function checkDevVars() {
  const path = resolve(root, ".dev.vars");
  if (!existsSync(path)) {
    return {
      exists: false,
      placeholder: false,
      hint: "Copy .dev.vars.example to .dev.vars and replace the placeholders.",
    };
  }
  const source = readFileSync(path, "utf8");
  const placeholder = /replace-with-/u.test(source);
  return {
    exists: true,
    placeholder,
    hint: placeholder
      ? "Replace the `replace-with-…` placeholders in .dev.vars with real keys."
      : "OK",
  };
}

function checkViteProxy() {
  // Reading the Vite config as text avoids a TypeScript compile step in the
  // scaffold tool and pins the contract covered by scripts/dev-proxy.test.mjs.
  const path = resolve(root, "apps/web/vite.config.ts");
  const source = readFileSync(path, "utf8");
  const match = source.match(
    new RegExp('"/api":\\s*"http://127\\.0\\.0\\.1:(\\d+)"'),
  );
  if (!match) {
    return {
      ok: false,
      port: null,
      hint: "Could not find /api proxy target in apps/web/vite.config.ts",
    };
  }
  const port = Number.parseInt(match[1], 10);
  return { ok: port === 8787, port, hint: "OK" };
}

function doctor() {
  const ciMode = process.argv.includes("--ci");
  const pkg = readJson("package.json");
  assertExactVersion("Node", process.versions.node, "22.22.1");
  const pnpm = capture("pnpm", ["--version"]);
  if (!pnpm.ok) {
    fail(
      "doctor.tool_missing",
      "pnpm is not available; install pnpm 10.32.1 from https://pnpm.io",
      5,
      { tool: "pnpm" },
    );
  }
  assertExactVersion("pnpm", pnpm.stdout, "10.32.1");
  const wrangler = capture("pnpm", ["exec", "wrangler", "--version"]);
  if (!wrangler.ok) {
    fail(
      "doctor.tool_missing",
      "Wrangler is not available; run `pnpm install` to provision it",
      5,
      { tool: "wrangler" },
    );
  }
  // Wrangler's banner is multi-line on some platforms; extract the first
  // semver-looking token rather than substring-matching the whole output.
  const wranglerVersion = wrangler.stdout.match(/\d+\.\d+\.\d+/u)?.[0] ?? "";
  assertExactVersion("Wrangler", wranglerVersion, "4.114.0");

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
  // R2 is opt-in via wrangler.r2.jsonc, not the root config — reporting it
  // is useful, but it is not a required binding to fail the doctor.
  const failingBindings = Object.entries(bindingChecks)
    .filter(([name, ok]) => !ok && name !== "r2Optional")
    .map(([name]) => name);
  if (failingBindings.length) {
    fail(
      "doctor.wrangler_config_invalid",
      `One or more root deployment bindings are missing: ${failingBindings.join(", ")}`,
      6,
      { bindingChecks, failingBindings },
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
  const devVars = checkDevVars();
  if (!ciMode && !devVars.exists) {
    fail(
      "doctor.dev_vars_missing",
      ".dev.vars is missing; create it before `wrangler dev` will work",
      6,
      { hint: devVars.hint },
    );
  }
  if (!ciMode && devVars.placeholder) {
    fail(
      "doctor.dev_vars_placeholder",
      ".dev.vars still contains `replace-with-…` placeholders",
      6,
      { hint: devVars.hint },
    );
  }
  const proxy = checkViteProxy();
  if (!proxy.ok) {
    fail(
      "doctor.vite_proxy_invalid",
      `Vite /api proxy points at port ${proxy.port ?? "?"}; expected 8787`,
      6,
      { hint: proxy.hint, port: proxy.port },
    );
  }
  const migrations = assertMigrationSet();
  output("doctor.completed", {
    status: "ok",
    node: process.versions.node,
    pnpm: pnpm.stdout.trim(),
    wrangler: wranglerVersion,
    migrations,
    localRuntimeSecrets: ciMode ? "skipped" : "checked",
    bindingChecks,
    storage: {
      backend: storageBackend,
      reason: storageReason,
    },
  });
}

if (command === "help" || command === "--help" || command === "-h") {
  printUsage();
  process.exit(0);
}

if (command === "doctor") {
  doctor();
} else if (command === "init") {
  mkdirSync(resolve(root, ".wrangler", "state"), { recursive: true });
  // Seed a placeholder .dev.vars from the example so `wrangler dev` is one
  // step away from working. The doctor will fail loudly if the operator did
  // not replace the placeholders — the seed is not a free pass.
  const target = resolve(root, ".dev.vars");
  if (!existsSync(target)) {
    const example = resolve(root, ".dev.vars.example");
    if (existsSync(example)) {
      writeFileSync(
        target,
        readFileSync(example, "utf8").replace(
          /(^|\n)# (INITIAL_ADMIN_EMAIL|INITIAL_ADMIN_PASSWORD)[^\n]*\n/gu,
          "$1",
        ),
        "utf8",
      );
      output("scaffold.dev_vars_seeded", { path: ".dev.vars" });
    }
  }
  doctor();
  run("node", ["scripts/migration.mjs", "migrate", "--target", "local"]);
  run("node", ["scripts/migration.mjs", "verify", "--target", "local"]);
  output("scaffold.init.completed", { status: "ok" });
} else {
  process.stderr.write(
    `unknown subcommand: ${command ?? "(none)"}\n\nRun \`pnpm scaffold help\` for usage.\n`,
  );
  fail("scaffold.usage", "Run `pnpm scaffold help` for usage", 2);
}
