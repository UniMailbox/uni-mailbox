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

## Scheduled send

A scheduled draft is a draft with a single pending `outbound_jobs` row
whose `available_at` is in the future. The schedule is the row — there is
no separate `messages.status='scheduled'` flag or mail folder.

### "Why didn't a scheduled draft send?"

1. Check the draft's `outbound_jobs` row in D1: confirm `status='pending'`
   and `available_at <= now`. If `available_at` is still in the future, the
   cron hasn't promoted it yet — the cron runs once a minute, so allow up
   to ~60 s of slack.
2. If the row is `pending` and due but the cron isn't promoting it, check
   `/health` for the scheduled trigger and inspect the
   `maintenance.metrics.aggregated` snapshot for the queue backlog.
3. If the row is already `enqueued` but never landed, check
   `outbound_jobs.lock_expires_at` and the
   `recoverExpiredOutboundLocks` cron — a worker that crashed after
   `processOutboundJob` claimed the row will be rescued within
   `runtimePolicy.outboundLockTtlMs` (5 minutes).
4. If the row is `failed`, inspect `last_error` and `messages.error_*` —
   the dispatcher already exhausted its retry budget.

### "How do I cancel a scheduled send?"

- UI: open the draft and use the **Cancel schedule** button.
- API: `DELETE /api/v1/drafts/:id/schedule` with the current `if-match`
  etag. The endpoint only revokes rows that are still
  `pending`/`enqueued`; once a worker has claimed the row the only
  responsible path is the dispatcher.
- After cancellation, the draft remains in `drafts` folder with
  unchanged content. A follow-up `POST /drafts/:id/send` (immediate) is
  allowed because the active schedule row is gone.

### "How do I reschedule?"

- UI: change the date and re-click **Schedule send**.
- API: re-POST to `POST /drafts/:id/schedule` with the new `scheduledAt`
  and the current `if-match`. The service reuses the existing pending
  `outbound_jobs` row (UPDATE path) and bumps the draft version; a new
  idempotency key is required because the hash changes.

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
