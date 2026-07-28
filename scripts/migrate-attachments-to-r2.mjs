#!/usr/bin/env node
// One-shot migration: copy every KV-backed attachment and raw-message object
// into the R2 bucket referenced by the ATTACHMENTS binding. Each real upload
// is verified before its KV source is deleted; --dry-run performs no writes.

import {
  AttachmentMigrationError,
  createAttachmentMigration,
} from "./attachment-migration-lib.mjs";
import { capture, fail, output, readJsonc, root } from "./_shared.mjs";

const args = process.argv.slice(2);

function readFlag(name, fallback) {
  const index = args.indexOf(`--${name}`);
  if (index < 0) return fallback;
  return args[index + 1] ?? fallback;
}

const bucketName = readFlag("bucket", null);
const dryRun = args.includes("--dry-run");
const accountId = readFlag("account", null);
const namespaceIdFlag = readFlag("namespace-id", null);
const binding = readFlag("binding", "KV");
const prefix = readFlag("prefix", "attachment:");

if (!bucketName) {
  fail(
    "migration.bucket_required",
    "--bucket <name> is required (the destination R2 bucket)",
    2,
  );
}

const apiToken = process.env.CLOUDFLARE_API_TOKEN;
if (!apiToken) {
  fail(
    "migration.api_token_missing",
    "Set CLOUDFLARE_API_TOKEN in the environment",
    2,
  );
}

const wranglerConfig = readJsonc("wrangler.r2.jsonc");
const kvNamespaces = wranglerConfig.kv_namespaces ?? [];
const kvBinding = kvNamespaces.find((entry) => entry.binding === binding);
if (!kvBinding) {
  fail(
    "migration.binding_missing",
    `wrangler.r2.jsonc has no kv_namespaces binding "${binding}"`,
    3,
    { binding },
  );
}

async function main() {
  output("migration.start", {
    bucket: bucketName,
    prefix,
    binding,
    dryRun,
    cwd: root,
  });
  const migration = createAttachmentMigration({
    apiToken,
    capture,
    fetch,
    output,
  });
  try {
    const account = await migration.resolveAccountId(accountId);
    const namespaceId = await migration.resolveNamespaceId(
      account,
      namespaceIdFlag ?? kvBinding.id ?? kvBinding.namespace_id,
      kvBinding.title ?? binding,
    );
    output("migration.account_resolved", { account, namespaceId });
    const result = await migration.migrate({
      account,
      namespaceId,
      bucket: bucketName,
      prefix,
      dryRun,
    });
    output("migration.completed", result);
    if (result.failed > 0) {
      fail(
        "migration.completed_with_errors",
        "Some keys failed to migrate",
        9,
        { failed: result.failed },
      );
    }
  } catch (error) {
    if (error instanceof AttachmentMigrationError) {
      fail(error.event, error.message, error.exitCode, error.fields);
    }
    fail(
      "migration.unexpected_error",
      error instanceof Error ? error.message : String(error),
      9,
    );
  }
}

await main();
