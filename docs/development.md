# Local development guide

This is the contributor's handbook for the local loop: clone, install, run,
test, change, ship. Operator-facing material lives under
[`../.skills/runbooks/`](runbooks/) and [`docs/operations/deployment.md`](../operations/deployment.md); the
repo layout, contracts, and architectural decisions are in
[`docs/rebuild-blueprint.md`](rebuild-blueprint.md).

## Prerequisites

| Tool               | Pinned version | Where to install                                              |
| ------------------ | -------------- | ------------------------------------------------------------- |
| Node               | 22.22.1        | `nvm install 22.22.1` / `volta pin node@22.22.1`              |
| pnpm               | 10.32.1        | `corepack enable && corepack prepare pnpm@10.32.1 --activate` |
| Wrangler           | 4.114.0        | comes from the dev dependency, `pnpm install` provides it     |
| Cloudflare account | —              | only required for live routing or provider verification       |

`pnpm scaffold doctor` is the single source of truth for "is my machine ready?".
Run it after every change to the toolchain or `wrangler.jsonc`.

## First-time setup

```bash
git clone <repository-url> unimailbox
cd unimailbox
pnpm install
cp .dev.vars.example .dev.vars
# Edit .dev.vars: replace BOTH `replace-with-…` placeholders with real keys.
# Each must be at least 32 random characters; do not reuse a value across keys.
pnpm scaffold init
INITIAL_ADMIN_EMAIL=admin@example.test \
  INITIAL_ADMIN_PASSWORD='correct horse battery staple' \
  pnpm bootstrap:admin -- --target local
pnpm build
pnpm dev
```

Open the URL Wrangler prints (default `http://127.0.0.1:8787`) and sign in at
`/login` with the initial administrator credentials. `pnpm dev:web` exists for
frontend-focused work — Vite serves the React app on `:5173` and proxies
`/api` and `/health` to the same Worker on `8787`. The two halves agree on the
port; [`scripts/dev-proxy.test.mjs`](../scripts/dev-proxy.test.mjs) pins that
contract so a drift fails CI instead of breaking the login form.

The two values in `.dev.vars` are local runtime secrets. Production releases
generate them automatically when they do not already exist.
`INITIAL_ADMIN_EMAIL` and `INITIAL_ADMIN_PASSWORD` are one-time bootstrap
inputs: the bootstrap hashes the password into D1, then the values can be
removed. Brevo and
Cloudflare settings are configured after login; credentials are encrypted with
AES-GCM and stored in D1. **Never commit `.dev.vars` or initial credentials.**

## The two ways to run the stack

```bash
pnpm dev          # Wrangler on :8787; serves the built web bundle out of apps/web/dist.
pnpm dev:web      # Wrangler on :8787 plus Vite on :5173 with HMR for the React app.
```

Use `pnpm dev` when the change is on the worker side or when you want a
release-shaped loop. Use `pnpm dev:web` when the change is JSX/CSS and you
want fast refresh. Both commands talk to the same D1/KV/Queue, so the
database is shared between them — logging out in one tab does not invalidate
sessions started in the other.

## Project layout

```text
apps/worker/        Worker entrypoints, HTTP router, feature modules
apps/web/           React/Vite application (entry: src/main.tsx)
packages/contracts  Runtime schemas and cross-boundary types
packages/email-core Provider-independent composition rules
packages/config     Runtime security and retry policy
packages/test-kit   Shared test fixtures
migrations/         Reviewed D1 SQL (immutable, paired with .verify.sql and .md)
scripts/            Scaffold, migration, release, and verification CLIs
.skills/runbooks/   Operator recovery procedures
```

When you are about to add a feature, use the table below to decide which
folder to edit:

| You are changing…                              | Edit under…                                                                            | Also touch…                                                                                                                             |
| ---------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| A REST endpoint or its request/response schema | `apps/worker/src/http/router.ts` and the matching `apps/worker/src/modules/<feature>/` | `packages/contracts/src/api/` for shared types, then update e2e stubs in `e2e/`                                                         |
| Business rules for an existing feature         | `apps/worker/src/modules/<feature>/`                                                   | its paired unit test in `apps/worker/test/unit/`                                                                                        |
| The web app's UI                               | `apps/web/src/features/<area>/` or `apps/web/src/components/`                          | add or update tests in `apps/web/src/**/__test__/` (the project runs Vitest in jsdom)                                                   |
| A shared type consumed by both sides           | `packages/contracts/src/`                                                              | export it from the package's `index.ts` and add a test in `packages/contracts/test/`                                                    |
| A scheduled job                                | `apps/worker/src/modules/maintenance/scheduled.ts`                                     | a paired worker test exercising the cron trigger path                                                                                   |
| A migration                                    | `migrations/NNNN_short_name.sql` (next index from `ls migrations/`)                    | `migrations/NNNN_short_name.verify.sql`, `migrations/NNNN_short_name.md`, then `pnpm db:migration:status` to confirm the ledger matches |

## Background tasks (cron triggers)

`wrangler.jsonc` defines three cron schedules, all funneled through a single
entrypoint: `apps/worker/src/entrypoints/scheduled.ts` →
`apps/worker/src/modules/maintenance/scheduled.ts::runScheduledTasks`. Every
tick is wrapped in `runWithHeartbeat`, which writes a status record to KV at
`health:scheduled:last_run` so `/health` can distinguish "trigger alive" from
"trigger stuck".

| Cron         | Cadence             | Purpose                                                                                 |
| ------------ | ------------------- | --------------------------------------------------------------------------------------- |
| `* * * * *`  | every minute        | Outbound lock recovery + dispatch due-now pending jobs + drain `maintenance_jobs` queue |
| `0 * * * *`  | top of every hour   | Adds hourly upload cleanup + 5-scalar operational metrics snapshot                      |
| `17 3 * * *` | 03:17 UTC every day | Adds TTL cleanup (sessions, idempotency, webhook × 90d) + trash + orphan-object R2 scan |

The 03:17 slot is offset from the top of the hour on purpose — see the comment
at `maintenance/scheduled.ts:11-17`. Running the heavy daily cleanup at the
same time as the hourly tick would contend with the worker's other
top-of-hour traffic.

### What every tick does

```text
runScheduledTasks(scheduledTime)
  └─ runWithHeartbeat(...)               // writes health:scheduled:last_run to KV
       ├─ 1. recoverExpiredOutboundLocks()           // status='processing' → 'pending' if lock expired
       ├─ 2. OutboundJobService.dispatchPending(100) // pending + available_at<=now → enqueue
       ├─ 3. [minute===0]  runHourlyMaintenance()
       ├─ 4. [03:17 UTC]   runDailyMaintenance()
       └─ 5. processMaintenanceJobs()               // generic cursor-style jobs (e.g. md5 backfill)
```

`recoverExpiredOutboundLocks` rescues rows the prior tick owned but never
finished (lock TTL is `runtimePolicy.outboundLockTtlMs`, 5 minutes). It is
idempotent against the active claim path inside `processOutboundJob`.

`dispatchPending` is what makes the cron → Queue handoff visible. The Queue
consumer at `entrypoints/queue.ts` only sees enqueued messages; the cron is
what promotes `pending` rows (whose `available_at <= now`) into
`status='enqueued'` and pushes them into `OUTBOUND_QUEUE`. Any `available_at`
in the future is held back here. **If you want user-facing scheduled send,
this is the lever to extend** — see the investigation at
[`../.skills/investigations/2026-08-06-queue-investigation.md`](investigations/2026-08-06-queue-investigation.md).

### Scheduled send (user-facing)

User-facing scheduled send is now part of the public draft API. The
`POST /api/v1/drafts/:id/schedule` endpoint inserts (or replaces) the
single pending `outbound_jobs` row whose `available_at` is the user-supplied
instant. Until the cron next ticks that row past its `available_at`, the
draft is held in the queue with the message and folder unchanged
(`messages.status='draft'`, `mailbox_messages.folder='drafts'`). The
`DELETE` endpoint deletes the same row, leaving the rest of the draft
intact. Because the queue and dispatcher treat `available_at` as the
single source of truth, **no new cron, job table, or durable object is
needed**. Test the schedule path by inserting a future `available_at` and
running `OutboundJobService.dispatchPending` directly; that bypasses the
cron wait without mocking the clock.

### Hourly tick (minute === 0)

| Task                          | What it does                                                                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `cleanupExpiredUploads`       | `attachment_uploads` rows past `expires_at` (LIMIT 100/tick), with R2 + attachment_files GC                                                            |
| `aggregateOperationalMetrics` | One-row snapshot: `queue_pending`, `queue_failed`, `webhook_failed`, `inbound_hour`, `outbound_hour` — emitted as `maintenance.metrics.aggregated` log |

### Daily tick (03:17 UTC)

| Task                      | What it does                                                                                                     |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `runDailyCleanup`         | DELETE expired sessions / idempotency_records / webhook_events (90d) / webhook_deliveries (90d)                  |
| `cleanupTrashAndMessages` | DELETE `message_user_state` (>30d), `mailbox_messages` in trash (>30d), and orphan `messages`+attachments        |
| `cleanupOrphanObjects`    | R2 list-scan (100 keys/tick) for objects with no DB reference; cursor persists in `maintenance_jobs.cursor_json` |

Orphan deletion is guarded by `orphan-policy.isOrphanCleanupEligible` — objects
younger than the policy window are skipped to avoid races with writes that
have not yet inserted their DB row.

### Generic `maintenance_jobs` table

`processMaintenanceJobs` reads `status IN ('pending','running')` rows from the
`maintenance_jobs` table and dispatches by `job_key`. Today only
`attachment-md5-backfill` is registered; its cursor (`{ objectKey }`) lets the
backfill resume across days without re-walking the table. Unrecognized
`job_key`s are marked `failed` with `No registered handler for <key>` so a
missing handler cannot loop forever.

### Adding or changing a cron task

1. Read `maintenance/scheduled.ts` end-to-end — every task is in that one file.
2. For a new tick on a new schedule, add an entry under `triggers.crons` in
   `wrangler.jsonc` and a new conditional branch in `runScheduledTasks`.
3. For a new generic job, register it in the `maintenanceHandlers` map at
   the bottom of `scheduled.ts`. It will be picked up automatically by the
   every-minute tick.
4. The hourly metrics snapshot is the source of truth for "is the system
   healthy?" — if your change moves work between ticks, update which scalar
   tracks it or add a new one.
5. Tests live alongside the module (`apps/worker/test/`) — for cron behavior,
   drive `runScheduledTasks` directly with a stubbed `ScheduledController`
   instead of waiting for the real trigger.

## Verification — what each command checks

```bash
pnpm scaffold doctor    # versions, wrangler.jsonc, .dev.vars, scripts, migrations
pnpm lint               # ESLint across the repo
pnpm typecheck          # tsc --noEmit for every package
pnpm format:check       # Prettier
pnpm schema:check       # drizzle-kit validates the migration set
pnpm test               # unit + worker + integration (Vitest in three configs)
pnpm test:unit          # packages + web app + worker unit + script self-tests
pnpm test:worker        # worker HTTP boundary tests in apps/worker/test/worker
pnpm test:integration   # tests that need the real Cloudflare bindings
pnpm test:coverage      # coverage report, threshold enforced in vitest.config.ts
pnpm test:e2e           # Playwright; the worker is stubbed, see e2e/README
pnpm build              # everything needed to deploy
pnpm deploy:dry-run     # d1 + kv + assets + queue dry-run, no writes
pnpm deploy:r2:dry-run  # same, with the opt-in R2 overlay
pnpm audit --prod       # pnpm production-only advisory check
```

The CI workflow (`.github/workflows/ci.yml`) runs the same checks in this
order. Local `pnpm test` matches the CI version pinning; the only step CI runs
that `pnpm test` does not is `pnpm audit`, which is a network-dependent check.

### Migrations

```bash
pnpm db:migration:new add_outbound_rate_limits  # scaffolds NNNN_add_outbound_rate_limits.{sql,verify.sql,md}
pnpm db:migration:status                         # prints the unapplied ledger entries
pnpm db:migrate --target local                   # apply to the local D1
pnpm db:migrate --target preview --confirm <id>  # preview environment
pnpm db:migrate --target production --confirm <id>  # production; refusal without --confirm is by design
pnpm db:verify                                   # compare checksums against the released ledger
```

Migrations are immutable once released. Never edit a `migrations/*.sql` file
that has a checksum in `migrations/checksums.json`; add a follow-up migration
instead. `pnpm scaffold doctor` enforces that rule.

### Releases

```bash
pnpm deploy             # credential-free first deploy: provision Cloudflare only
pnpm deployment:bootstrap # then migrate, create admin, and attach runtime secrets
pnpm release:preview    # dry-run + a preview Worker deployment
pnpm release:production # the operator-gated promotion; refuses without CLOUDFLARE_* secrets
pnpm release:rollback   # re-points DNS to the previous release (Cloudflare-only)
pnpm release:verify     # post-promotion smoke tests against the deployed URL
```

`pnpm deploy` requires no administrator credentials. Run
`pnpm deployment:bootstrap` explicitly with the one-time administrator inputs
after Cloudflare provisioning. Production releases are intentionally
operator-gated — the GitHub release
workflow ([`.github/workflows/release.yml`](../.github/workflows/release.yml))
requires a `workflow_dispatch` with a verified deployment URL and rolls back
automatically on smoke-test failure. Local `pnpm release:production` skips
that gate; never use it outside of an active incident.

## Conventions

- **TypeScript is strict.** A change that requires `any` to compile almost
  always wants a type in `packages/contracts` instead.
- **No mock data in the web app.** Every list, form, and detail view pulls
  from the Worker. If a screen needs a placeholder, it renders the
  `LoadingState` or `ErrorState` from `apps/web/src/components/Status.tsx`.
- **Route protection is enforced on the server, mirrored on the client.**
  The typed TanStack Router authenticated parent and administration route
  guards mirror the real authority in `requireAuth()` middleware in
  `apps/worker/src/http/router.ts`. Never add a page-level redirect or client
  permission check that differs from the matching endpoint.
- **Frontend API and form boundaries are explicit.** Add a runtime-validated
  operation to `packages/contracts/src/api/`, index it in `endpoints.ts`, and
  call it through a feature-owned Query or mutation option. Production forms
  use the shared TanStack Form composition; no generic request helper or React
  Hook Form compatibility layer remains.
- **Product copy is localized.** Use i18next keys for visible and accessible
  text, map server failures by stable error code, and keep technical values
  such as IDs and email addresses bidi-isolated. Run `pnpm i18n:check` and
  `pnpm frontend:contracts` before frontend changes are submitted.
- **Every HTTP error has a stable `code`.** The web client surfaces the
  `code` in `ErrorState`; do not strip it before returning a JSON error.
- **Idempotency keys are mandatory on every admin write.** Use
  `requireAdminIdempotency` in the router and supply an
  `idempotency-key` header from the web client; this is what makes a retry
  safe across a partition.
- **Secrets are never logged.** Use `context.get("appContext").logger.info`
  with the redacting wrappers, not `console.log`.

## Where to get help

- Failing CI? Re-read the failing step's name — it almost always points to
  the right local command.
- Stuck on a Cloudflare detail? Start at
  [`docs/operations/deployment.md`](../operations/deployment.md); recovery procedures are in
  `../.skills/runbooks/`.
- Adding a new feature? Skim the matching chapter in
  [`docs/rebuild-blueprint.md`](rebuild-blueprint.md) before writing code —
  the design choices there are the source of the contract tests in
  `packages/contracts/test/`.
- Not sure whether something is "the frontend's job" or "the worker's job"?
  The data flow is always: web client → `/api/v1/*` → router middleware →
  application service → D1/KV/R2. The web client only reads what the
  application service chooses to expose.
