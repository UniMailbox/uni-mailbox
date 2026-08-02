#!/usr/bin/env node
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fail, output, root } from "./_shared.mjs";
import { findUnpinnedActions } from "./workflow-security-lib.mjs";

const workflowDirectory = resolve(root, ".github/workflows");
const violations = readdirSync(workflowDirectory)
  .filter((name) => /\.ya?ml$/u.test(name))
  .flatMap((name) =>
    findUnpinnedActions(
      readFileSync(resolve(workflowDirectory, name), "utf8"),
    ).map((reference) => ({ file: `.github/workflows/${name}`, reference })),
  );
if (violations.length > 0) {
  fail(
    "workflow.actions_unpinned",
    "Every remote GitHub Action must be pinned to a full commit SHA",
    6,
    { violations },
  );
}
output("workflow.security_completed", { status: "ok" });
