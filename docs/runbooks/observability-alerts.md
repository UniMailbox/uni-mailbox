# Observability and alert response

UniMailbox emits structured JSON events through Workers Logs and exposes a
minimal public `/health` response. The scheduled handler writes
`health:scheduled:last_run` to KV; `/health` reports the trigger as `pending`,
`ok`, or `stale` without exposing configuration or message data.

## Required post-deploy alerts

Cloudflare notification destinations are account-owned and cannot be safely
embedded in a reusable `wrangler.jsonc`. After the first deployment, connect the
operator destination in **Notifications** and create these policies:

| Signal            | Trigger                                                            | First response                                      |
| ----------------- | ------------------------------------------------------------------ | --------------------------------------------------- |
| Worker errors     | Sustained exception/error increase for `unimailbox`                | Check request IDs and the newest deployment version |
| Scheduled trigger | `/health` reports `scheduled: stale` for two checks                | Inspect Cron Trigger events and KV availability     |
| Queue failures    | `failed_jobs > 0` or messages appear in `unimailbox-outbound-dead` | Follow the outbound recovery runbook                |
| Webhook failures  | `failed_webhooks > 0` for two checks                               | Verify Brevo secret and run reconciliation          |
| D1/R2/KV          | Any `/health` binding check is `error` or `missing`                | Stop promotion and inspect the affected binding     |
| Inbound silence   | No expected inbound smoke event during a release drill             | Verify Email Routing and the Worker catch-all rule  |

Use the administration analytics endpoint for `failed_jobs` and
`failed_webhooks`. If the account sends Workers Logs to a SIEM, alert on the
structured event names `http.request.failed`, `outbound.send.failed`, and
`webhook.processing.failed`; never alert on message bodies or credential fields.

## Release drill

1. Record the current Worker version and D1 bookmark.
2. Run `pnpm release:verify https://mail.example.com`.
3. Confirm `/health` has no missing/error/stale check.
4. Send one inbound marker and one outbound marker from setup repair mode.
5. Confirm the Queue drains, the Brevo webhook advances status, and no dead
   letter is created.
6. Reconcile the provider and compare the control-plane metrics.
7. Exercise Worker version rollback in a non-production environment. Database
   restoration is a separate, explicitly approved incident action.

Record the drill date, actor, deployment/version IDs, D1 bookmark, marker
message IDs, result, and any corrective action in the release ticket.
