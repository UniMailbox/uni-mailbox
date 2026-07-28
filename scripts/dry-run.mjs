#!/usr/bin/env node
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { output, root, run } from "./_shared.mjs";

mkdirSync(resolve(root, ".wrangler", "logs"), { recursive: true });
run("pnpm", ["build"]);
run(
  "pnpm",
  [
    "exec",
    "wrangler",
    "deploy",
    "--env",
    "",
    "--dry-run",
    "--outdir",
    ".wrangler/dry-run",
  ],
  {
    env: {
      ...process.env,
      WRANGLER_LOG_PATH: resolve(root, ".wrangler", "logs", "dry-run.log"),
    },
  },
);
output("deployment.dry_run.completed", { status: "ok" });
