#!/usr/bin/env node
import { output, run } from "./_shared.mjs";

const wranglerArgs = (args) => [
  "exec",
  "wrangler",
  "--config",
  "wrangler.jsonc",
  ...args,
];

output("deployment.initial.started", {
  status: "running",
  phase: "provision-cloudflare",
});

run("pnpm", ["build"]);

// A Deploy Button repository has no remote resources yet. Keep this command to
// the single operation that can create the Worker and provision its bindings;
// application setup is an explicit follow-up after Cloudflare writes the IDs.
run("pnpm", wranglerArgs(["deploy", "--env", ""]));

output("deployment.initial.completed", {
  status: "ok",
  cloudflareProvisioned: true,
  credentialsRequired: false,
  verificationSkipped: true,
  next: "Set INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD, then run pnpm deployment:bootstrap",
});
