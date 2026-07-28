#!/usr/bin/env node
// One-shot migration: copy every KV-backed attachment and raw-message object
// into the Cloudflare R2 bucket referenced by the `ATTACHMENTS` binding of
// `wrangler.r2.jsonc`. Verifies each object by R2 `head` before deleting the
// KV copies. Idempotent — re-running the script is safe.
//
// Usage:
//     pnpm migrate:kv-to-r2 --bucket unimailbox-attachments [--dry-run]
//                            [--account <accountId>] [--binding KV] [--prefix attachment:]

import {
  capture,
  fail,
  output,
  readJsonc,
  root,
} from "./_shared.mjs";

const args = process.argv.slice(2);

function readFlag(name, fallback) {
  const index = args.indexOf(`--${name}`);
  if (index < 0) return fallback;
  return args[index + 1] ?? fallback;
}

const bucketName = readFlag("bucket", null);
const dryRun = args.includes("--dry-run");
const accountId = readFlag("account", null);
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

async function resolveAccountId() {
  if (accountId) return accountId;
  const whoami = capture("pnpm", [
    "exec",
    "wrangler",
    "whoami",
    "--format",
    "json",
  ]);
  if (!whoami.ok) {
    fail(
      "migration.whoami_failed",
      "Run `wrangler login` or pass --account <accountId>",
      4,
      { stderr: whoami.stderr },
    );
  }
  try {
    const parsed = JSON.parse(whoami.stdout);
    return parsed.account?.id ?? parsed.id;
  } catch {
    fail(
      "migration.whoami_parse_failed",
      "Could not parse `wrangler whoami` output",
      5,
      { stdout: whoami.stdout },
    );
  }
}

async function resolveNamespaceId(account, nsName) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${account}/storage/kv/namespaces`;
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${apiToken}` },
  });
  if (!res.ok) {
    fail(
      "migration.namespace_list_failed",
      `Failed to list KV namespaces: ${res.status}`,
      6,
      { body: await res.text() },
    );
  }
  const json = await res.json();
  const found = json.result.find((ns) => ns.title === nsName);
  if (!found) {
    fail(
      "migration.namespace_not_found",
      `No KV namespace titled "${nsName}" in account ${account}`,
      7,
      { available: json.result.map((ns) => ns.title) },
    );
  }
  return found.id;
}

async function listKvKeys(account, namespaceId, prefixStr, cursor) {
  const url = new URL(
    `https://api.cloudflare.com/client/v4/accounts/${account}/storage/kv/namespaces/${namespaceId}/keys`,
  );
  url.searchParams.set("prefix", prefixStr);
  if (cursor) url.searchParams.set("cursor", cursor);
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${apiToken}` },
  });
  if (!res.ok) {
    fail(
      "migration.kv_list_failed",
      `Failed to list KV keys: ${res.status}`,
      8,
      { body: await res.text() },
    );
  }
  const json = await res.json();
  return {
    keys: json.result.map((entry) => entry.name),
    cursor: json.result_info?.cursor ?? null,
  };
}

async function readKvValue(account, namespaceId, key) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${account}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}?string=false`;
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${apiToken}` },
  });
  if (!res.ok) {
    throw new Error(`Failed to read KV value ${key}: ${res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function deleteKvKey(account, namespaceId, key) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${account}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: { authorization: `Bearer ${apiToken}` },
  });
  if (!res.ok) {
    throw new Error(`Failed to delete KV key ${key}: ${res.status}`);
  }
}

async function putR2Object(account, bucket, key, body, metadata) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${account}/storage/buckets/${bucket}/objects/${encodeURIComponent(key)}`;
  const headers = {
    authorization: `Bearer ${apiToken}`,
  };
  if (metadata?.contentType) headers["content-type"] = metadata.contentType;
  if (metadata?.contentDisposition) {
    headers["content-disposition"] = metadata.contentDisposition;
  }
  if (metadata?.customMetadata) {
    for (const [k, v] of Object.entries(metadata.customMetadata)) {
      headers[`x-amz-meta-${k}`] = String(v);
    }
  }
  const res = await fetch(url, {
    method: "PUT",
    headers,
    body,
  });
  if (!res.ok) {
    throw new Error(`Failed to upload R2 object ${key}: ${res.status}`);
  }
}

async function headR2Object(account, bucket, key) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${account}/storage/buckets/${bucket}/objects/${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: "HEAD",
    headers: { authorization: `Bearer ${apiToken}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Failed to HEAD R2 object ${key}: ${res.status}`);
  }
  const size = Number(res.headers.get("content-length") ?? "0");
  return { size };
}

async function readMetaKey(account, namespaceId, key) {
  // KV value parsing — we wrote JSON to attachment-meta:<key>. The default
  // read returns raw bytes; parse here.
  const raw = await readKvValue(account, namespaceId, key);
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    return null;
  }
}

async function main() {
  output("migration.start", {
    bucket: bucketName,
    prefix,
    binding,
    dryRun,
    cwd: root,
  });
  const account = await resolveAccountId();
  const namespaceId = await resolveNamespaceId(account, kvBinding.id ?? kvBinding.namespace_id ?? binding);
  output("migration.account_resolved", { account, namespaceId });

  let cursor = null;
  let listed = 0;
  let uploaded = 0;
  let skipped = 0;
  let failed = 0;
  let bytesTotal = 0;
  const startTime = Date.now();

  do {
    const page = await listKvKeys(account, namespaceId, prefix, cursor);
    for (const fullKey of page.keys) {
      listed += 1;
      // The KV body key is `<prefix><storageKey>`; recover the storage key
      // by stripping the body prefix.
      const storageKey = fullKey.slice(prefix.length);
      try {
        const body = await readKvValue(account, namespaceId, fullKey);
        const meta = await readMetaKey(
          account,
          namespaceId,
          `attachment-meta:${storageKey}`,
        ).catch(() => null);
        const existing = await headR2Object(account, bucketName, storageKey);
        if (!existing || existing.size !== body.byteLength) {
          if (!dryRun) {
            await putR2Object(account, bucketName, storageKey, body, {
              contentType: meta?.httpMetadata?.contentType,
              contentDisposition: meta?.httpMetadata?.contentDisposition,
              customMetadata: meta?.customMetadata,
            });
          }
          uploaded += 1;
          bytesTotal += body.byteLength;
        } else {
          skipped += 1;
        }
        const verified = await headR2Object(account, bucketName, storageKey);
        if (!verified || verified.size !== body.byteLength) {
          throw new Error(
            `R2 object ${storageKey} has size ${verified?.size}, expected ${body.byteLength}`,
          );
        }
        if (!dryRun) {
          await deleteKvKey(account, namespaceId, fullKey);
          await deleteKvKey(
            account,
            namespaceId,
            `attachment-meta:${storageKey}`,
          ).catch(() => undefined);
        }
      } catch (error) {
        failed += 1;
        output("migration.key_failed", {
          key: storageKey,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    cursor = page.cursor;
  } while (cursor);

  output("migration.completed", {
    dryRun,
    listed,
    uploaded,
    skipped,
    failed,
    bytesTotal,
    durationMs: Date.now() - startTime,
  });
  if (failed > 0) {
    fail("migration.completed_with_errors", "Some keys failed to migrate", 9, {
      failed,
    });
  }
}

await main();