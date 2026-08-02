#!/usr/bin/env node
import { fail, output, readJsonc } from "./_shared.mjs";
import { findWranglerParityErrors } from "./config-parity-lib.mjs";

const errors = findWranglerParityErrors(
  readJsonc("wrangler.jsonc"),
  readJsonc("wrangler.r2.jsonc"),
);
if (errors.length > 0) {
  fail("config.parity_failed", errors.join("; "), 6, { errors });
}
output("config.parity_completed", { status: "ok" });
