export const WHOAMI_ARGS = ["exec", "wrangler", "whoami", "--json"];

export class AttachmentMigrationError extends Error {
  constructor(event, message, exitCode, fields = {}) {
    super(message);
    this.name = "AttachmentMigrationError";
    this.event = event;
    this.exitCode = exitCode;
    this.fields = fields;
  }
}

function apiSegment(value) {
  return encodeURIComponent(value);
}

function objectKeyPath(key) {
  return key.split("/").map(apiSegment).join("/");
}

const HTTP_METADATA_HEADERS = {
  contentType: "content-type",
  contentDisposition: "content-disposition",
  contentLanguage: "content-language",
  contentEncoding: "content-encoding",
  cacheControl: "cache-control",
};

export function r2ObjectUrl(account, bucket, key) {
  return `https://api.cloudflare.com/client/v4/accounts/${apiSegment(account)}/r2/buckets/${apiSegment(bucket)}/objects/${objectKeyPath(key)}`;
}

export function createAttachmentMigration({
  apiToken,
  capture,
  fetch: fetchImpl,
  output,
  now = Date.now,
}) {
  const authorization = { authorization: `Bearer ${apiToken}` };

  async function resolveAccountId(explicitAccountId) {
    if (explicitAccountId) return explicitAccountId;
    const whoami = capture("pnpm", WHOAMI_ARGS);
    if (!whoami.ok) {
      throw new AttachmentMigrationError(
        "migration.whoami_failed",
        "Run `wrangler login` or pass --account <accountId>",
        4,
        { stderr: whoami.stderr },
      );
    }
    let parsed;
    try {
      parsed = JSON.parse(whoami.stdout);
    } catch {
      throw new AttachmentMigrationError(
        "migration.whoami_parse_failed",
        "Could not parse the account ID from `wrangler whoami --json`",
        5,
        { stdout: whoami.stdout },
      );
    }
    const direct = parsed.account?.id ?? parsed.id;
    if (typeof direct === "string" && direct.length > 0) return direct;
    const accounts = Array.isArray(parsed.accounts)
      ? parsed.accounts
          .map((account) => account?.id)
          .filter((id) => typeof id === "string" && id.length > 0)
      : [];
    if (accounts.length === 1) return accounts[0];
    if (accounts.length > 1) {
      throw new AttachmentMigrationError(
        "migration.account_ambiguous",
        "Multiple Cloudflare accounts are available; pass --account <accountId>",
        5,
        { accounts },
      );
    }
    throw new AttachmentMigrationError(
      "migration.whoami_parse_failed",
      "Could not parse the account ID from `wrangler whoami --json`",
      5,
      { stdout: whoami.stdout },
    );
  }

  async function resolveNamespaceId(account, configuredId, namespaceTitle) {
    if (configuredId) return configuredId;
    const url = new URL(
      `https://api.cloudflare.com/client/v4/accounts/${apiSegment(account)}/storage/kv/namespaces`,
    );
    url.searchParams.set("per_page", "1000");
    const res = await fetchImpl(url, { headers: authorization });
    if (!res.ok) {
      throw new AttachmentMigrationError(
        "migration.namespace_list_failed",
        `Failed to list KV namespaces: ${res.status}`,
        6,
        { body: await res.text() },
      );
    }
    const json = await res.json();
    const namespaces = Array.isArray(json.result) ? json.result : [];
    const found = namespaces.find(
      (namespace) => namespace.title === namespaceTitle,
    );
    if (!found) {
      throw new AttachmentMigrationError(
        "migration.namespace_not_found",
        `No KV namespace titled "${namespaceTitle}" in account ${account}`,
        7,
        { available: namespaces.map((namespace) => namespace.title) },
      );
    }
    return found.id;
  }

  async function listKvKeys(account, namespaceId, prefix, cursor) {
    const url = new URL(
      `https://api.cloudflare.com/client/v4/accounts/${apiSegment(account)}/storage/kv/namespaces/${apiSegment(namespaceId)}/keys`,
    );
    url.searchParams.set("prefix", prefix);
    url.searchParams.set("limit", "1000");
    if (cursor) url.searchParams.set("cursor", cursor);
    const res = await fetchImpl(url, { headers: authorization });
    if (!res.ok) {
      throw new AttachmentMigrationError(
        "migration.kv_list_failed",
        `Failed to list KV keys: ${res.status}`,
        8,
        { body: await res.text() },
      );
    }
    const json = await res.json();
    return {
      keys: (json.result ?? []).map((entry) => entry.name),
      cursor: json.result_info?.cursor ?? null,
    };
  }

  async function readKvValue(
    account,
    namespaceId,
    key,
    { allowMissing = false } = {},
  ) {
    const url = `https://api.cloudflare.com/client/v4/accounts/${apiSegment(account)}/storage/kv/namespaces/${apiSegment(namespaceId)}/values/${apiSegment(key)}?string=false`;
    const res = await fetchImpl(url, { headers: authorization });
    if (allowMissing && res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`Failed to read KV value ${key}: ${res.status}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }

  async function deleteKvKey(account, namespaceId, key) {
    const url = `https://api.cloudflare.com/client/v4/accounts/${apiSegment(account)}/storage/kv/namespaces/${apiSegment(namespaceId)}/values/${apiSegment(key)}`;
    const res = await fetchImpl(url, {
      method: "DELETE",
      headers: authorization,
    });
    if (res.status === 404) return;
    if (!res.ok) {
      throw new Error(`Failed to delete KV key ${key}: ${res.status}`);
    }
  }

  async function putR2Object(account, bucket, key, body, metadata) {
    const headers = { ...authorization };
    if (metadata?.contentType) headers["content-type"] = metadata.contentType;
    if (metadata?.contentDisposition) {
      headers["content-disposition"] = metadata.contentDisposition;
    }
    if (metadata?.contentLanguage) {
      headers["content-language"] = metadata.contentLanguage;
    }
    if (metadata?.contentEncoding) {
      headers["content-encoding"] = metadata.contentEncoding;
    }
    if (metadata?.cacheControl) {
      headers["cache-control"] = metadata.cacheControl;
    }
    for (const [metadataKey, value] of Object.entries(
      metadata?.customMetadata ?? {},
    )) {
      headers[`x-amz-meta-${metadataKey.toLowerCase()}`] = String(value);
    }
    const res = await fetchImpl(r2ObjectUrl(account, bucket, key), {
      method: "PUT",
      headers,
      body,
    });
    if (!res.ok) {
      throw new Error(`Failed to upload R2 object ${key}: ${res.status}`);
    }
  }

  async function headR2Object(account, bucket, key) {
    const res = await fetchImpl(r2ObjectUrl(account, bucket, key), {
      method: "HEAD",
      headers: authorization,
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`Failed to HEAD R2 object ${key}: ${res.status}`);
    }
    return {
      size: Number(res.headers.get("content-length") ?? "0"),
      headers: res.headers,
    };
  }

  function r2ObjectMatches(existing, size, metadata) {
    if (!existing || existing.size !== size) return false;
    for (const [metadataKey, headerName] of Object.entries(
      HTTP_METADATA_HEADERS,
    )) {
      const expected = metadata?.[metadataKey];
      if (expected && existing.headers.get(headerName) !== String(expected)) {
        return false;
      }
    }
    for (const [metadataKey, expected] of Object.entries(
      metadata?.customMetadata ?? {},
    )) {
      if (
        existing.headers.get(`x-amz-meta-${metadataKey.toLowerCase()}`) !==
        String(expected)
      ) {
        return false;
      }
    }
    return true;
  }

  async function readMetaKey(account, namespaceId, key) {
    const raw = await readKvValue(account, namespaceId, key, {
      allowMissing: true,
    });
    if (!raw) return null;
    try {
      return JSON.parse(raw.toString("utf8"));
    } catch {
      return null;
    }
  }

  async function migrate({ account, namespaceId, bucket, prefix, dryRun }) {
    let cursor = null;
    let listed = 0;
    let planned = 0;
    let uploaded = 0;
    let skipped = 0;
    let failed = 0;
    let bytesTotal = 0;
    const startTime = now();

    do {
      const page = await listKvKeys(account, namespaceId, prefix, cursor);
      for (const fullKey of page.keys) {
        listed += 1;
        const storageKey = fullKey.slice(prefix.length);
        try {
          const body = await readKvValue(account, namespaceId, fullKey);
          const meta = await readMetaKey(
            account,
            namespaceId,
            `attachment-meta:${storageKey}`,
          );
          const metadata = {
            contentType: meta?.httpMetadata?.contentType,
            contentDisposition: meta?.httpMetadata?.contentDisposition,
            contentLanguage: meta?.httpMetadata?.contentLanguage,
            contentEncoding: meta?.httpMetadata?.contentEncoding,
            cacheControl: meta?.httpMetadata?.cacheControl,
            customMetadata: meta?.customMetadata,
          };
          const existing = await headR2Object(account, bucket, storageKey);
          if (!r2ObjectMatches(existing, body.byteLength, metadata)) {
            bytesTotal += body.byteLength;
            if (dryRun) {
              planned += 1;
              continue;
            }
            await putR2Object(account, bucket, storageKey, body, metadata);
            const verified = await headR2Object(account, bucket, storageKey);
            if (!r2ObjectMatches(verified, body.byteLength, metadata)) {
              throw new Error(
                `R2 object ${storageKey} did not match the expected size and metadata`,
              );
            }
            uploaded += 1;
          } else {
            skipped += 1;
          }
          if (dryRun) continue;
          await deleteKvKey(
            account,
            namespaceId,
            `attachment-meta:${storageKey}`,
          );
          await deleteKvKey(account, namespaceId, fullKey);
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

    return {
      dryRun,
      listed,
      planned,
      uploaded,
      skipped,
      failed,
      bytesTotal,
      durationMs: now() - startTime,
    };
  }

  return {
    migrate,
    resolveAccountId,
    resolveNamespaceId,
  };
}
