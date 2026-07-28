# Outbound, webhook, and provider recovery

## Outbound Queue

1. Check `/health` and the administration analytics for failed jobs.
2. Confirm the provider connection health without exposing encrypted
   credentials.
3. Inspect structured events for `outbound.dispatch.deferred`,
   `outbound.send.failed`, retry count, message ID, and provider key.
4. Correct the provider or network condition. The minute recovery job enqueues
   due `pending` jobs and recovers expired processing locks.
5. Do not create a second send command; retain the original idempotency key.
6. Quarantine permanently failed jobs for operator review.

## Webhooks

1. Verify the provider connection ID and bearer verification secret.
2. Inspect webhook deliveries and events in the control plane.
3. Duplicate provider event IDs are expected to resolve idempotently.
4. Run provider reconciliation after restoring connectivity.
5. Delete webhook audit rows only under the configured retention policy.

## Inbound

1. Confirm Cloudflare Email Routing targets this Worker and the managed domain.
2. Run the setup/repair inbound smoke test.
3. Inspect redacted inbound logs and object presence (`/health` returns
   `storage.backend` so you know whether to inspect KV `attachment:` keys or
   R2 objects); never log message bodies or attachment bytes.
4. If D1 persistence failed after object writes, run orphan-object
   maintenance. The `cleanupOrphanObjects` cron iterates the configured
   backend (KV `list({prefix: 'attachment:'})` or R2 `list`). KV `list` is
   eventually consistent within roughly 60 seconds, so a `DELETE` may briefly
   reappear as a candidate before the list catches up — re-run if needed.
