import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "..");
const scaffold = join(repoRoot, "scripts", "scaffold.mjs");

function run(args, { cwd, env = {} } = {}) {
  const target = cwd ?? repoRoot;
  return spawnSync("node", [scaffold, ...args], {
    cwd: target,
    encoding: "utf8",
    env: { ...process.env, UNIMAILBOX_SCAFFOLD_ROOT: target, ...env },
  });
}

function cp(src, dest) {
  // Minimal copy: doctor only reads these files. Pulling node_modules would
  // blow the budget for no added coverage.
  const targets = [
    "package.json",
    "wrangler.jsonc",
    ".dev.vars",
    "apps/web/vite.config.ts",
    "apps/web/package.json",
    "apps/worker/package.json",
    "migrations",
  ];
  for (const target of targets) {
    const from = join(src, target);
    const to = join(dest, target);
    copyEntry(from, to);
  }
}

function copyEntry(from, to) {
  const isDir = spawnSync("test", ["-d", from]).status === 0;
  if (isDir) return;
  const content = readFileSync(from);
  const parent = resolve(to, "..");
  spawnSync("mkdir", ["-p", parent]);
  writeFileSync(to, content);
}

function lastJsonLine(output) {
  const lines = output.trim().split("\n");
  return JSON.parse(lines[lines.length - 1]);
}

describe("scaffold CLI", () => {
  let workdir;

  beforeEach(() => {
    // Each test gets a clean checkout copy so we can mutate .dev.vars,
    // package.json, and wrangler.jsonc without polluting the real repo.
    workdir = mkdtempSync(join(tmpdir(), "scaffold-test-"));
    cp(repoRoot, workdir);
  });

  afterEach(() => {
    rmSync(workdir, { recursive: true, force: true });
  });

  it("prints a human-readable help banner", () => {
    const result = run(["help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/USAGE/u);
    expect(result.stdout).toMatch(/pnpm scaffold init/u);
    expect(result.stdout).toMatch(/pnpm scaffold doctor/u);
  });

  it("accepts --help and -h aliases", () => {
    expect(run(["--help"]).status).toBe(0);
    expect(run(["-h"]).status).toBe(0);
  });

  it("rejects an unknown subcommand with a friendly hint", () => {
    const result = run(["nope"]);
    expect(result.status).toBe(2);
    const payload = lastJsonLine(result.stdout);
    expect(payload.event).toBe("scaffold.usage");
    expect(payload.message).toMatch(/pnpm scaffold help/u);
  });

  it("surfaces a missing .dev.vars file", () => {
    rmSync(join(workdir, ".dev.vars"));
    const result = run(["doctor"], { cwd: workdir });
    expect(result.status).toBe(6);
    const payload = lastJsonLine(result.stdout);
    expect(payload.event).toBe("doctor.dev_vars_missing");
    expect(payload.hint).toMatch(/\.dev\.vars/u);
  });

  it("flags .dev.vars placeholders that have not been replaced", () => {
    writeFileSync(
      join(workdir, ".dev.vars"),
      "AUTH_SIGNING_KEY=replace-with-real-secret\n",
      "utf8",
    );
    const result = run(["doctor"], { cwd: workdir });
    expect(result.status).toBe(6);
    const payload = lastJsonLine(result.stdout);
    expect(payload.event).toBe("doctor.dev_vars_placeholder");
  });

  it("flags a Vite /api proxy pointing at the wrong port", () => {
    const configPath = join(workdir, "apps", "web", "vite.config.ts");
    const source = readFileSync(configPath, "utf8");
    writeFileSync(
      configPath,
      source.replace("http://127.0.0.1:8787", "http://127.0.0.1:9000"),
      "utf8",
    );
    const result = run(["doctor"], { cwd: workdir });
    expect(result.status).toBe(6);
    const payload = lastJsonLine(result.stdout);
    expect(payload.event).toBe("doctor.vite_proxy_invalid");
    expect(payload.port).toBe(9000);
  });

  it("does not treat R2 as a required binding", () => {
    // The opt-in R2 overlay lives in wrangler.r2.jsonc, not the root config.
    // Reporting the backend is useful; failing the doctor on it is not.
    const result = run(["doctor"], { cwd: workdir });
    expect(result.status).toBe(0);
    const payload = lastJsonLine(result.stdout);
    expect(payload.bindingChecks.r2Optional).toBe(false);
  });
});
