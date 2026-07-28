# Enabling Cloudflare R2 and migrating existing data

Use this runbook when a deployment has been running on the default KV backend
and you want to switch to Cloudflare R2 (paid plan, larger objects, native
metadata). It assumes the deployment is healthy and that you have
administrative access to the Cloudflare account.

## 1. Verify the current backend

```bash
curl https://<worker-url>/health
```

Confirm `data.storage.backend === "kv"`. If R2 is already active, you do not
need this runbook.

## 2. Provision an R2 bucket

In the Cloudflare dashboard, create the bucket (e.g. `unimailbox-attachments`)
in the same account as the Worker. Note:

- The bucket name (e.g. `unimailbox-attachments`).
- A separate preview bucket (`unimailbox-preview-attachments`) for the
  preview environment if it should not share data with production.

## 3. Deploy with the overlay

`wrangler.r2.jsonc` mirrors the default config and adds the `ATTACHMENTS`
binding. Apply it with:

```bash
pnpm deploy:r2
```

This runs `wrangler deploy -c wrangler.r2.jsonc` for the production Worker
and its preview environment. After deployment, `/health` returns
`data.storage.backend === "r2"`. The runtime now writes new objects to R2;
existing KV objects remain in place and are still readable until the
migration script below removes them.

## 4. Record the KV namespace ID

After the first `wrangler deploy` of `wrangler.r2.jsonc`, Cloudflare assigns a
namespace ID to the `KV` binding. Capture it for the migration script:

```bash
pnpm exec wrangler kv:namespace list
```

Look for the row titled `KV` (or whichever title matches the binding). Copy
its `id`.

Optionally, pin the ID inside `wrangler.r2.jsonc`:

```jsonc
"kv_namespaces": [{ "binding": "KV", "id": "<namespace-id>" }],
```

This avoids relying on title-based lookups.

## 5. Run the migration

```bash
CLOUDFLARE_API_TOKEN=<token with R2 + KV write> \
  pnpm migrate:kv-to-r2 --bucket unimailbox-attachments
```

Pass `--dry-run` first to see what would change. The script:

1. Lists every `attachment:<key>` body in the KV namespace (cursor-paginated).
2. Reads the corresponding `attachment-meta:<key>` for `httpMetadata` /
   `customMetadata`.
3. `PUT`s the body and headers into R2 with the same key.
4. `HEAD`s the R2 object to confirm the size matches.
5. Deletes the two KV keys (`attachment:<key>` and `attachment-meta:<key>`).
6. Skips keys already in R2 with matching size (idempotent).

A summary event is emitted at the end:

```json
{
  "event": "migration.completed",
  "listed": 1234,
  "uploaded": 1230,
  "skipped": 4,
  "failed": 0,
  "bytesTotal": 987654321,
  "durationMs": 12345
}
```

A non-zero `failed` count exits with code 9 and prints
`migration.key_failed` events with the per-key error. Re-run the script after
fixing any transient API failures; the script picks up where it left off.

## 6. Verify

```bash
pnpm exec wrangler kv:key list --binding=KV --prefix=attachment:
# expect: empty list

pnpm exec wrangler r2 object list unimailbox-attachments | head
# expect: raw/ and attachments/ prefixes populated
```

Send a new attachment through the UI to confirm the live path also lands in
R2.

## 7. Rollback

If R2 misbehaves in production, the path back to KV is:

1. Remove the `r2_buckets` block from `wrangler.r2.jsonc` (or stop using the
   overlay entirely).
2. `pnpm deploy` (uses `wrangler.jsonc` without R2).
3. The runtime detects the missing `ATTACHMENTS` binding and falls back to KV
   for new writes. Previously migrated R2 objects are no longer reachable;
   the worker returns `ATTACHMENT_OBJECT_MISSING` (HTTP 503) for old
   references until they are re-uploaded.

Re-running `pnpm migrate:kv-to-r2 --bucket unimailbox-attachments` after a
rollback is a no-op — it only touches KV keys, and KV is now empty.