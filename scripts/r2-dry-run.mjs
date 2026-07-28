#!/usr/bin/env node
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { output, root, run } from "./_shared.mjs";

const outputRoot = resolve(root, ".wrangler", "r2-dry-run");
mkdirSync(outputRoot, { recursive: true });
run("pnpm", ["build"]);
for (const [environment, outdir] of [
  ["", resolve(outputRoot, "production")],
  ["preview", resolve(outputRoot, "preview")],
]) {
  run("pnpm", [
    "exec",
    "wrangler",
    "deploy",
    "--config",
    "wrangler.r2.jsonc",
    "--env",
    environment,
    "--dry-run",
    "--outdir",
    outdir,
  ]);
}
output("deployment.r2_dry_run.completed", {
  status: "ok",
  environments: ["production", "preview"],
});
