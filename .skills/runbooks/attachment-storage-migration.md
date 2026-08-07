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

The same state is available after login under **Settings → Storage & runtime**.
`KV healthy` plus `R2 missing` is a supported healthy configuration, not an
installation failure.

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

This runs two explicit deployments in sequence: `deploy:r2:production` targets
the top-level environment and `deploy:r2:preview` targets `--env preview`.
After deployment, `/health` returns `data.storage.backend === "r2"`. New
objects are written to R2. The read path checks R2 first and then falls back to
KV, so historical messages and queued outbound attachments remain available
while the migration runs. If the second deployment fails, rerun
`pnpm deploy:r2:preview` before directing traffic to preview.

Open **Settings → Storage & runtime** and run **Verify R2 write access**. The
probe writes, heads, and deletes a namespaced object. A successful probe marks
only the `r2_storage` configuration checkpoint as verified.

## 4. Record the KV namespace ID

After the first `wrangler deploy` of `wrangler.r2.jsonc`, Cloudflare assigns a
namespace ID to the `KV` binding. Capture it for the migration script:

```bash
pnpm exec wrangler kv namespace list
```

Look for the row titled `KV` (or whichever title matches the binding). Copy
its `id`.

Optionally, pin the ID inside `wrangler.r2.jsonc`:

```jsonc
"kv_namespaces": [{ "binding": "KV", "id": "<namespace-id>" }],
```

This avoids relying on title-based lookups. You can also pass the ID directly
as `--namespace-id <namespace-id>`; configured and explicit IDs bypass the
namespace-title lookup.

## 5. Run the migration

```bash
CLOUDFLARE_API_TOKEN=<token with R2 + KV write> \
  pnpm migrate:kv-to-r2 --bucket unimailbox-attachments \
    --namespace-id <namespace-id> --dry-run
```

If `wrangler whoami --json` returns more than one account, also pass
`--account <account-id>` so the script never guesses a destination account.
Review the dry-run summary, then repeat without `--dry-run`. A dry run performs
no upload, verification, or deletion and records missing/mismatched
destinations under `planned`, not `failed`. The script:

1. Lists every `attachment:<key>` body in the KV namespace (cursor-paginated).
2. Reads the corresponding `attachment-meta:<key>` for `httpMetadata` /
   `customMetadata`.
3. `PUT`s the body and headers into R2 with the same key.
4. `HEAD`s the R2 object to confirm its size and all source metadata match.
5. Deletes `attachment-meta:<key>` and then `attachment:<key>` so a failed
   sidecar cleanup leaves the body available for a safe retry.
6. Skips keys already in R2 with matching size and metadata (idempotent).

A summary event is emitted at the end:

```json
{
  "event": "migration.completed",
  "listed": 1234,
  "planned": 0,
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
pnpm exec wrangler kv key list \
  --namespace-id <namespace-id> --prefix=attachment: --remote
# expect: empty list

curl --fail --silent --show-error \
  --header "Authorization: Bearer <token>" \
  "https://api.cloudflare.com/client/v4/accounts/<account-id>/r2/buckets/unimailbox-attachments/objects?prefix=attachments%2F&per_page=10"
# expect: success=true and result objects under attachments/
```

Send a new attachment through the UI to confirm the live path also lands in
R2. Re-open **Settings → Storage & runtime** and confirm the active backend is
R2. A failed probe or migration is resumable and does not change the binding;
binding presence remains the source of truth.

## 7. Rollback

If R2 misbehaves in production, the path back to KV is:

1. Remove the `r2_buckets` block from `wrangler.r2.jsonc` (or stop using the
   overlay entirely).
2. `pnpm deploy` (uses `wrangler.jsonc` without R2).
3. The runtime detects the missing `ATTACHMENTS` binding and falls back to KV
   for new writes. Previously migrated R2 objects are no longer reachable;
   the worker returns `ATTACHMENT_OBJECT_MISSING` (HTTP 503) for old
   references until they are re-uploaded.

Do not delete the R2 bucket during rollback. If the migration already removed
the KV copies, deploy the R2 overlay again to restore access, or run an
approved R2-to-KV recovery before returning to the KV-only configuration.
