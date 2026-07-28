# Zero-Touch Cloudflare Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a fresh Cloudflare deployment require only an initial administrator email and password, bootstrap that administrator during release, and move Cloudflare Mail and optional R2 configuration behind authenticated settings.

**Architecture:** The release pipeline reconciles per-Worker runtime secrets, applies and verifies D1 migrations, and idempotently bootstraps the first administrator before promotion. The Worker no longer exposes an installation-claim surface; it treats incomplete bootstrap as a deployment fault and routes completed installations to login. Existing Cloudflare/domain/provider operations move from setup-session authorization to administrator authorization, while optional R2 remains a verified settings extension over the KV default.

**Tech Stack:** Node.js 22 release scripts, Wrangler 4, Cloudflare Workers, D1, KV, Queues, Hono, TypeScript, React 18, TanStack Query, Vitest, Cloudflare Vitest pool, Playwright, pnpm 10.

## Global Constraints

- `INITIAL_ADMIN_EMAIL` is a build-only variable and `INITIAL_ADMIN_PASSWORD` is a build-only secret.
- `INITIAL_ADMIN_PASSWORD` must be 12–1024 characters and must never appear in logs, command arguments, generated manifests, or committed files.
- `AUTH_SIGNING_KEY` and `CREDENTIAL_ENCRYPTION_KEY` are 32-byte random per-Worker secrets generated only when remote state proves they are missing.
- An unknown remote secret state fails closed; normal deployments never rotate established runtime keys.
- `INSTALLATION_TOKEN` is removed from production, local development, contracts, documentation, and tests.
- D1, KV, Queue, and Assets remain mandatory. R2 remains optional and KV remains the default attachment backend.
- The administrator login email is identity-only and never creates a mailbox, domain, or Email Routing rule.
- Existing administrators and encrypted credentials must not be overwritten by redeployment.
- All production changes follow strict red-green-refactor TDD and add no new runtime dependency.

---

## File Structure

### New files

- `scripts/bootstrap-lib.mjs`: pure validation, random-secret reconciliation, PBKDF2 record generation, SQL literal encoding, and redacted diagnostic helpers.
- `scripts/bootstrap-admin.mjs`: production/local administrator bootstrap CLI using Wrangler D1 execution.
- `scripts/bootstrap.test.mjs`: release-helper and CLI behavior tests using controlled command fakes.
- `migrations/0004_zero_touch_bootstrap.sql`: installation-state normalization and configuration-checkpoint storage.
- `migrations/meta/0004_zero_touch_bootstrap.verify.sql`: schema/data invariants for migration 0004.
- `migrations/meta/0004_zero_touch_bootstrap.md`: migration compatibility and recovery metadata.
- `apps/worker/src/modules/administration/cloudflare-settings.ts`: authenticated Cloudflare Mail/provider configuration service extracted from setup.
- `apps/worker/src/modules/administration/infrastructure-settings.ts`: required-binding and optional-R2 status service.
- `apps/web/src/features/settings/CloudflareSettings.tsx`: Cloudflare domain, Email Routing, provider, and smoke-test settings UI.
- `apps/web/src/features/settings/StorageSettings.tsx`: required-resource health and optional-R2 UI.

### Removed files

- `apps/web/src/features/setup/SetupPage.tsx`
- `apps/web/src/features/setup/SetupPage.test.tsx`

### Modified files

- `scripts/release-lib.mjs`: insert secret reconciliation and bootstrap steps into the release step model.
- `scripts/release.mjs`: generate/upload missing runtime secrets and invoke bootstrap before promotion/direct deployment.
- `scripts/release.test.mjs`: release order, redaction, and fallback coverage.
- `scripts/_shared.mjs`: secure temporary-file helper used by release/bootstrap scripts.
- `package.json`: remove installation-token metadata and add bootstrap command.
- `.dev.vars.example`: remove installation token and document build-only bootstrap inputs.
- `wrangler.jsonc`, `wrangler.r2.jsonc`: replace Secrets Store bootstrap bindings with required per-Worker secret declarations.
- `packages/config/src/index.ts`, `packages/config/test/config.test.ts`: remove installation token from runtime configuration.
- `packages/contracts/src/api/index.ts`, `packages/contracts/src/domain/index.ts`, `packages/contracts/test/contracts.test.ts`: remove claim schema and reduce installation state.
- `apps/worker/src/platform/config.ts`: remove installation token binding.
- `apps/worker/src/app-context.ts`: compose authenticated settings services without setup sessions.
- `apps/worker/src/http/router.ts`: remove public setup mutations and register authenticated settings routes.
- `apps/worker/src/modules/installation/index.ts`: reduce installation status semantics to bootstrap/complete.
- `apps/worker/src/modules/installation/infrastructure/d1-installation.repository.ts`: read normalized state.
- `apps/worker/src/modules/installation/setup-use-cases.ts`: delete setup-session workflow after extraction.
- `apps/worker/src/modules/identity/application.ts`: add identity-only email change and keep password session revocation.
- `apps/worker/test/unit/installation.test.ts`: reduced state rules.
- `apps/worker/test/unit/identity*.test.ts`: email/password account-security coverage.
- `apps/worker/test/integration/setup.test.ts`: replace setup-session tests with authenticated settings tests.
- `apps/worker/test/integration/migrations.test.ts`: migration 0004 assertions.
- `apps/worker/test/integration/env-fixture.ts` and other environment fixtures: remove installation token.
- `apps/worker/test/worker/http.test.ts`: setup redirect and removed endpoint behavior.
- `apps/web/src/App.tsx`, `apps/web/src/App.test.tsx`: remove setup bundle and route settings sections.
- `apps/web/src/features/settings/SettingsPage.tsx`: add account email, Cloudflare, and storage sections.
- `apps/web/src/features/settings/SettingsPage.test.tsx`: authenticated configuration UI coverage.
- `e2e/setup.spec.ts`, `e2e/setup-extras.spec.ts`, `e2e/login.spec.ts`: replace wizard scenarios with bootstrap/login/settings scenarios.
- `README.md`, `docs/deployment.md`, `docs/rebuild-blueprint.md`, `docs/runbooks/setup-recovery.md`: document zero-touch bootstrap and authenticated configuration.

---

### Task 1: Secure Runtime Secret Reconciliation

**Files:**

- Create: `scripts/bootstrap-lib.mjs`
- Create: `scripts/bootstrap.test.mjs`
- Modify: `scripts/_shared.mjs`
- Modify: `scripts/release-lib.mjs`
- Test: `scripts/bootstrap.test.mjs`
- Test: `scripts/release.test.mjs`

**Interfaces:**

- Produces:

  - `validateInitialAdministrator(environment): { email: string; password: string }`
  - `reconcileRuntimeSecretNames(existingNames, randomBytes): Record<string, string>`
  - `createPasswordRecord(password, options?): Promise<PasswordRecord>`
  - `sqlLiteral(value): string`
  - `withSecureTemporaryJson(directory, value, callback): Promise<T>`
  - release steps `reconcile-runtime-secrets` and `bootstrap-administrator`

- [ ] **Step 1: Write failing pure-helper tests**

```js
it("generates only confirmed-missing runtime secrets", () => {
  const generated = reconcileRuntimeSecretNames(["AUTH_SIGNING_KEY"], () =>
    Uint8Array.from({ length: 32 }, (_, index) => index),
  );
  expect(Object.keys(generated)).toEqual(["CREDENTIAL_ENCRYPTION_KEY"]);
  expect(generated.CREDENTIAL_ENCRYPTION_KEY).toMatch(/^[A-Za-z0-9_-]{43}$/u);
});

it("requires initial credentials only when bootstrap needs them", () => {
  expect(() =>
    validateInitialAdministrator({
      INITIAL_ADMIN_EMAIL: "admin@example.com",
      INITIAL_ADMIN_PASSWORD: "short",
    }),
  ).toThrow(/12 characters/u);
});
```

- [ ] **Step 2: Run the helper tests and verify RED**

Run:

```bash
pnpm exec vitest run scripts/bootstrap.test.mjs
```

Expected: FAIL because `scripts/bootstrap-lib.mjs` and its exports do not exist.

- [ ] **Step 3: Implement validation, random generation, PBKDF2, and SQL encoding**

```js
export const runtimeSecretNames = [
  "AUTH_SIGNING_KEY",
  "CREDENTIAL_ENCRYPTION_KEY",
];

export function reconcileRuntimeSecretNames(existingNames, randomBytes) {
  if (!Array.isArray(existingNames)) {
    throw new Error("Remote runtime secret state is unavailable");
  }
  return Object.fromEntries(
    runtimeSecretNames
      .filter((name) => !existingNames.includes(name))
      .map((name) => [name, base64Url(randomBytes(32))]),
  );
}
```

Use `crypto.pbkdf2` with SHA-256, 310,000 iterations, a 16-byte random salt,
and a 32-byte derived key so the build record exactly matches
`PasswordService`.

- [ ] **Step 4: Add secure temporary-file lifecycle tests and implementation**

The test must assert mode `0o600`, JSON content, and deletion after both a
successful callback and a thrown callback. Implement the helper with
`writeFileSync(path, json, { mode: 0o600, flag: "wx" })` and a `finally`
block calling `unlinkSync`.

- [ ] **Step 5: Add release-step ordering tests**

```js
expect(productionReleaseSteps("direct-deploy")).toEqual([
  "reconcile-runtime-secrets",
  "capture-bookmark",
  "migrate-production",
  "verify-migrations",
  "bootstrap-administrator",
  "deploy-direct",
]);
```

The verified-version path must place `bootstrap-administrator` after migration
verification and before `promote-version`.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run:

```bash
pnpm exec vitest run scripts/bootstrap.test.mjs scripts/release.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/bootstrap-lib.mjs scripts/bootstrap.test.mjs scripts/_shared.mjs scripts/release-lib.mjs scripts/release.test.mjs
git commit -m "feat(deploy): reconcile bootstrap secrets safely"
```

---

### Task 2: Idempotent D1 Administrator Bootstrap

**Files:**

- Create: `scripts/bootstrap-admin.mjs`
- Create: `migrations/0004_zero_touch_bootstrap.sql`
- Create: `migrations/meta/0004_zero_touch_bootstrap.verify.sql`
- Create: `migrations/meta/0004_zero_touch_bootstrap.md`
- Modify: `migrations/meta/released-checksums.json`
- Modify: `package.json`
- Modify: `scripts/bootstrap.test.mjs`
- Modify: `apps/worker/test/integration/migrations.test.ts`

**Interfaces:**

- Consumes:
  - `validateInitialAdministrator`
  - `createPasswordRecord`
  - `sqlLiteral`
- Produces:

  - CLI: `node scripts/bootstrap-admin.mjs --target local|preview|production`
  - event `bootstrap.administrator.completed`
  - event `bootstrap.administrator.existing`

- [ ] **Step 1: Write failing migration and bootstrap behavior tests**

The integration test must assert migration 0004 changes a fresh
`installation_state.current_step` to `admin_bootstrap` and creates a
`configuration_checkpoints` row set containing:

```ts
expect(keys).toEqual([
  "brevo",
  "cloudflare_mail",
  "inbound_smoke_test",
  "outbound_smoke_test",
  "r2_storage",
]);
```

The CLI test fake must return administrator count `0`, capture the generated
SQL file, and assert that it contains the normalized email, password hash,
administrator role ID, and `current_step = 'complete'`, but not the plaintext
password.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
pnpm exec vitest run scripts/bootstrap.test.mjs apps/worker/test/integration/migrations.test.ts --config vitest.integration.config.ts
```

Expected: FAIL because migration 0004 and the bootstrap CLI do not exist.

- [ ] **Step 3: Add migration 0004 and verification artifacts**

Migration 0004 must:

```sql
UPDATE installation_state
SET current_step = CASE
      WHEN status = 'complete' THEN 'complete'
      ELSE 'admin_bootstrap'
    END,
    completed_steps_json = CASE
      WHEN status = 'complete' THEN '["admin_bootstrap"]'
      ELSE '[]'
    END,
    updated_at = CURRENT_TIMESTAMP
WHERE id = 1;
```

Create `configuration_checkpoints` with a constrained status
`pending|configured|verified|failed`, JSON metadata, recoverable error fields,
and timestamps. Seed the five stable keys listed in Step 1 with
`INSERT OR IGNORE`.

- [ ] **Step 4: Implement the bootstrap CLI**

The CLI must first query only the administrator count:

```sql
SELECT COUNT(*) AS administrator_count
FROM users u
JOIN user_roles ur ON ur.user_id = u.id
WHERE ur.role_id = '00000000-0000-4000-8000-000000000001';
```

If the count is non-zero, execute a state-only idempotent update to complete.
If it is zero, validate build inputs, generate the password record, and submit
one D1 SQL file whose statements use guarded `INSERT ... SELECT ... WHERE NOT
EXISTS` operations. After execution, re-query:

```sql
SELECT COUNT(*) AS administrator_count
FROM users u
JOIN user_roles ur ON ur.user_id = u.id
WHERE ur.role_id = '00000000-0000-4000-8000-000000000001';
```

Require the result to equal `1` and require installation state `complete`.

- [ ] **Step 5: Test idempotency and rollback-visible failure behavior**

Run the generated batch twice against the integration D1 database. Assert one
administrator and unchanged password hash after the second run. Inject an
invalid seeded role ID and assert the bootstrap reports failure and its
postcondition verifier refuses promotion.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run:

```bash
pnpm exec vitest run scripts/bootstrap.test.mjs
pnpm test:integration
pnpm db:verify --target local
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/bootstrap-admin.mjs scripts/bootstrap.test.mjs migrations package.json apps/worker/test/integration/migrations.test.ts
git commit -m "feat(deploy): bootstrap the first administrator"
```

---

### Task 3: Integrate Bootstrap Into Production Release

**Files:**

- Modify: `scripts/release.mjs`
- Modify: `scripts/release.test.mjs`
- Modify: `scripts/bootstrap.test.mjs`
- Modify: `package.json`
- Modify: `wrangler.jsonc`
- Modify: `wrangler.r2.jsonc`
- Modify: `.dev.vars.example`

**Interfaces:**

- Consumes:
  - runtime-secret reconciliation from Task 1
  - `bootstrap-admin.mjs` from Task 2
- Produces:

  - release manifest fields `bootstrap`, `runtimeSecretsCreated`
  - safe failure `release.runtime_secret_state_invalid`
  - safe failure `release.legacy_secret_migration_required`

- [ ] **Step 1: Write failing release orchestration tests**

The test command fake must prove:

1. secret state is inspected before version upload;
2. missing secrets are passed only through a restricted `--secrets-file`;
3. D1 migration and verification precede administrator bootstrap;
4. bootstrap precedes direct deploy or version promotion;
5. the fallback release path preserves the same order;
6. no emitted event includes supplied credentials or generated secrets.

- [ ] **Step 2: Run release tests and verify RED**

Run:

```bash
pnpm exec vitest run scripts/release.test.mjs scripts/bootstrap.test.mjs
```

Expected: FAIL on the missing release steps and manifest fields.

- [ ] **Step 3: Implement safe secret inspection and upload**

Use `wrangler secret list --env "" --json` for per-Worker secrets. Parse only
an array of objects with string `name` fields. Any non-zero exit, malformed
JSON, or different shape emits `release.runtime_secret_state_invalid` and
stops.

When secrets are missing, create a temporary JSON file and append
`--secrets-file <path>` to `versions upload` or direct `deploy`. Existing names
must not be included in the file.

- [ ] **Step 4: Add legacy encrypted-data guard**

Before replacing a legacy Secrets Store encryption binding, query
`encrypted_credentials` count. A positive count without a completed explicit
key-migration marker emits `release.legacy_secret_migration_required` and
stops. Empty early installations may adopt the generated per-Worker secret.

- [ ] **Step 5: Invoke administrator bootstrap in both production modes**

Run:

```js
run("node", ["scripts/bootstrap-admin.mjs", "--target", "production"]);
```

after migration verification and before `deploy-direct` or
`promote-version`. Persist only `{ status: "created" | "existing" }` in the
release manifest.

- [ ] **Step 6: Update Wrangler and deployment metadata**

Remove `INSTALLATION_TOKEN` and bootstrap Secrets Store bindings. Declare:

```json
"secrets": {
  "required": ["AUTH_SIGNING_KEY", "CREDENTIAL_ENCRYPTION_KEY"]
}
```

Remove the three old `cloudflare.bindings` prompts from `package.json`. Add
`bootstrap:admin` script and document `INITIAL_ADMIN_EMAIL` /
`INITIAL_ADMIN_PASSWORD` as build settings rather than runtime bindings.

- [ ] **Step 7: Run focused release and dry-run verification**

Run:

```bash
pnpm exec vitest run scripts/release.test.mjs scripts/bootstrap.test.mjs
pnpm deploy:dry-run
```

Expected: PASS; dry-run lists D1, KV, Queue, Assets, and required secret names,
with no installation-token binding.

- [ ] **Step 8: Commit**

```bash
git add scripts package.json wrangler.jsonc wrangler.r2.jsonc .dev.vars.example
git commit -m "feat(deploy): automate zero-touch bootstrap"
```

---

### Task 4: Remove the Public Installation Surface

**Files:**

- Modify: `packages/config/src/index.ts`
- Modify: `packages/config/test/config.test.ts`
- Modify: `packages/contracts/src/api/index.ts`
- Modify: `packages/contracts/src/domain/index.ts`
- Modify: `packages/contracts/test/contracts.test.ts`
- Modify: `apps/worker/src/platform/config.ts`
- Modify: `apps/worker/src/app-context.ts`
- Modify: `apps/worker/src/http/router.ts`
- Modify: `apps/worker/src/modules/installation/index.ts`
- Modify: `apps/worker/src/modules/installation/infrastructure/d1-installation.repository.ts`
- Delete after extraction: `apps/worker/src/modules/installation/setup-use-cases.ts`
- Modify: `apps/worker/test/unit/installation.test.ts`
- Modify: `apps/worker/test/unit/platform.test.ts`
- Modify: `apps/worker/test/worker/http.test.ts`
- Modify: all Worker environment fixtures containing `INSTALLATION_TOKEN`

**Interfaces:**

- Produces:

  - `InstallationStep.ADMIN_BOOTSTRAP`
  - `InstallationStep.COMPLETE`
  - deployment-incomplete response code `BOOTSTRAP_INCOMPLETE`

- [ ] **Step 1: Write failing contract and HTTP tests**

```ts
expect(InstallationStep).toEqual({
  ADMIN_BOOTSTRAP: "admin_bootstrap",
  COMPLETE: "complete",
});

const claim = await app.request("/api/v1/setup/claim", { method: "POST" }, env);
expect(claim.status).toBe(404);
```

Also assert `/setup` redirects to `/login` for a complete installation and an
incomplete installation returns a redacted `503 BOOTSTRAP_INCOMPLETE` for
ordinary application routes.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
pnpm --filter @unimailbox/contracts test
pnpm --filter @unimailbox/config test
pnpm exec vitest run apps/worker/test/unit apps/worker/test/worker
```

Expected: FAIL because old steps, claim schema, binding, and routes remain.

- [ ] **Step 3: Reduce contracts and runtime configuration**

Remove `InstallationClaimSchema` and `INSTALLATION_TOKEN`. Keep runtime parsing
for the two generated secrets and `ALLOWED_ORIGINS`.

- [ ] **Step 4: Replace setup middleware and routes**

The middleware must:

```ts
if (status.currentStep !== InstallationStep.COMPLETE) {
  throw new DomainError(
    "BOOTSTRAP_INCOMPLETE",
    "Deployment bootstrap has not completed",
    503,
  );
}
```

Permit `/health`, `/login` assets, and the auth login endpoint as appropriate.
Register `/setup` as a redirect rather than an application wizard. Remove all
unauthenticated `/api/v1/setup/*` mutations.

- [ ] **Step 5: Simplify installation repository and delete setup-session code**

Keep status reads and a two-step transition assertion only. Move Cloudflare and
provider methods to Task 5 before deleting `setup-use-cases.ts`.

- [ ] **Step 6: Update environment fixtures and run focused tests**

Run:

```bash
pnpm --filter @unimailbox/contracts test
pnpm --filter @unimailbox/config test
pnpm test:worker
pnpm exec vitest run apps/worker/test/unit
```

Expected: PASS with no fixture containing `INSTALLATION_TOKEN`.

- [ ] **Step 7: Commit**

```bash
git add packages apps/worker
git commit -m "refactor(setup): remove installation claim flow"
```

---

### Task 5: Move Cloudflare Mail Operations Behind Administrator Auth

**Files:**

- Create: `apps/worker/src/modules/administration/cloudflare-settings.ts`
- Modify: `apps/worker/src/modules/administration/index.ts`
- Modify: `apps/worker/src/app-context.ts`
- Modify: `apps/worker/src/http/router.ts`
- Modify: `apps/worker/test/integration/setup.test.ts`
- Modify: `apps/worker/test/integration/admin.test.ts`
- Delete: `apps/worker/src/modules/installation/setup-use-cases.ts`

**Interfaces:**

- Produces authenticated endpoints:

  - `GET /api/v1/admin/cloudflare/status`
  - `POST /api/v1/admin/cloudflare/oauth/start`
  - `GET /api/v1/admin/cloudflare/oauth/callback`
  - `POST /api/v1/admin/cloudflare/oauth/revoke`
  - `POST /api/v1/admin/cloudflare/verify`
  - `POST /api/v1/admin/domains`
  - `POST /api/v1/admin/cloudflare/inbound-smoke-test`
  - `POST /api/v1/admin/provider-connections/brevo`
  - `POST /api/v1/admin/cloudflare/outbound-smoke-test`

- [ ] **Step 1: Write failing authorization and isolation tests**

For every state-changing endpoint assert:

- no access token returns `401`;
- a member without `settings.manage` returns `403`;
- an administrator can execute the operation;
- a failed checkpoint updates only its matching
  `configuration_checkpoints` row and leaves installation `complete`.

- [ ] **Step 2: Run focused integration tests and verify RED**

Run:

```bash
pnpm exec vitest run --config vitest.integration.config.ts apps/worker/test/integration/setup.test.ts apps/worker/test/integration/admin.test.ts
```

Expected: FAIL because authenticated settings endpoints do not exist.

- [ ] **Step 3: Extract Cloudflare/provider logic from setup**

`CloudflareSettingsService` accepts `Principal` on every public method and
calls:

```ts
private requireManageSettings(principal: Principal): void {
  if (!principal.permissions.has("settings.manage")) {
    throw new DomainError(
      "PERMISSION_DENIED",
      "Permission settings.manage is required",
      403,
    );
  }
}
```

Replace setup-session KV state with OAuth state containing the initiating
administrator user ID, PKCE verifier, redirect URI, and ten-minute expiry.
OAuth callback redirects to `/settings/cloudflare?connected=true`.

- [ ] **Step 4: Persist independent checkpoint results**

On success set `status = 'verified'`, clear recoverable errors, and store only
non-secret structural metadata. On failure set the matching row to `failed`
with a stable error code and operator-safe message, then rethrow the domain
error. Never change `installation_state`.

- [ ] **Step 5: Register authenticated routes and remove setup service**

Apply `requireAuth()` and rely on service-level `settings.manage` checks.
Delete `SetupApplicationService` after every reusable operation is extracted.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run:

```bash
pnpm test:integration
pnpm exec vitest run apps/worker/test/unit
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/worker
git commit -m "feat(settings): secure Cloudflare mail configuration"
```

---

### Task 6: Add Account Email Changes and Infrastructure/R2 Status

**Files:**

- Create: `apps/worker/src/modules/administration/infrastructure-settings.ts`
- Modify: `apps/worker/src/modules/identity/application.ts`
- Modify: `apps/worker/src/http/router.ts`
- Modify: `apps/worker/src/app-context.ts`
- Modify: `apps/worker/test/unit/identity.test.ts`
- Modify: `apps/worker/test/unit/identity-extra.test.ts`
- Modify: `apps/worker/test/integration/admin.test.ts`

**Interfaces:**

- Produces:

  - `IdentityApplicationService.changeEmail(principal, password, email)`
  - `GET /api/v1/admin/infrastructure`
  - `POST /api/v1/admin/storage/r2/verify`

- [ ] **Step 1: Write failing identity and infrastructure tests**

Assert email change:

- requires current password;
- normalizes and updates only `users.email`;
- does not create a domain or mailbox;
- rejects duplicates;
- revokes other sessions.

Assert infrastructure status:

```ts
expect(status).toMatchObject({
  required: {
    d1: "ok",
    kv: "ok",
    queue: "ok",
    assets: "ok",
  },
  attachments: {
    backend: "kv",
    r2: "missing",
  },
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
pnpm exec vitest run apps/worker/test/unit/identity.test.ts apps/worker/test/unit/identity-extra.test.ts
pnpm exec vitest run --config vitest.integration.config.ts apps/worker/test/integration/admin.test.ts
```

Expected: FAIL because email change and infrastructure endpoints do not exist.

- [ ] **Step 3: Implement identity-only email change**

Verify current password with `PasswordService`, update `users.email`, revoke
all current refresh sessions, and return the normalized email. Map D1 unique
constraint failures to `IDENTITY_EMAIL_EXISTS`.

- [ ] **Step 4: Implement read-only infrastructure and R2 verification**

Reuse `HealthService` and `detectStorageBackend`. The R2 verify endpoint
requires `settings.manage`, performs a namespaced write/head/delete probe when
`ATTACHMENTS` exists, and never changes the active backend by database flag.
Binding presence remains the source of truth.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
pnpm exec vitest run apps/worker/test/unit/identity.test.ts apps/worker/test/unit/identity-extra.test.ts
pnpm test:integration
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/worker
git commit -m "feat(settings): manage identity and infrastructure"
```

---

### Task 7: Replace Setup UI With Authenticated Settings

**Files:**

- Create: `apps/web/src/features/settings/CloudflareSettings.tsx`
- Create: `apps/web/src/features/settings/StorageSettings.tsx`
- Delete: `apps/web/src/features/setup/SetupPage.tsx`
- Delete: `apps/web/src/features/setup/SetupPage.test.tsx`
- Modify: `apps/web/src/features/settings/SettingsPage.tsx`
- Create or modify: `apps/web/src/features/settings/SettingsPage.test.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.test.tsx`
- Modify: `apps/web/src/styles.css`
- Modify: `e2e/setup.spec.ts`
- Modify: `e2e/setup-extras.spec.ts`
- Modify: `e2e/login.spec.ts`

**Interfaces:**

- Consumes Task 5 and Task 6 endpoints.
- Produces routes:

  - `/settings`
  - `/settings/mailboxes`
  - `/settings/cloudflare`
  - `/settings/storage`

- [ ] **Step 1: Write failing component and route tests**

Assert:

- `/setup` renders no installation wizard and navigates to `/login`;
- Account Security changes login email and password;
- Cloudflare settings show checkpoint state and retry only the failed action;
- Storage settings show D1/KV required health and KV as healthy when R2 is
  absent;
- R2 verify is disabled until the binding is reported present.

- [ ] **Step 2: Run web tests and verify RED**

Run:

```bash
pnpm --filter @unimailbox/web test
```

Expected: FAIL because setup is still routed and new settings components are
absent.

- [ ] **Step 3: Remove setup route and add settings navigation**

Delete the lazy `SetupPage` import. In `App`, redirect `/setup` to `/login`
using the existing navigation helper. Extend settings section parsing to
`account|mailboxes|cloudflare|storage`.

- [ ] **Step 4: Implement account email and password forms**

Email form submits `{ currentPassword, email }` to
`/auth/email`. Password form keeps `/auth/password/reset`. After either action,
clear the access token and navigate to `/login` because refresh sessions were
revoked.

- [ ] **Step 5: Implement Cloudflare settings**

Render separate cards for account connection, domain/Email Routing, inbound
test, Brevo, and outbound test. Each card reads its checkpoint status and owns
its mutation/error state. Do not recreate a global ordered wizard.

- [ ] **Step 6: Implement infrastructure and R2 settings**

Always show D1, KV, Queue, and Assets health. When R2 is absent, show KV as the
active healthy backend and provide the dashboard-assisted R2 instructions.
When R2 is present, enable verification and link to migration status.

- [ ] **Step 7: Replace Playwright setup scenarios**

The first scenario must start at `/login`, submit the initial administrator
credentials, and assert navigation to the workspace. Add authenticated mocked
settings scenarios for Cloudflare and KV-without-R2.

- [ ] **Step 8: Run web and E2E tests and verify GREEN**

Run:

```bash
pnpm --filter @unimailbox/web test
pnpm test:e2e
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web e2e
git commit -m "feat(settings): replace setup wizard with admin settings"
```

---

### Task 8: Documentation, Compatibility Audit, and Full Verification

**Files:**

- Modify: `README.md`
- Modify: `docs/deployment.md`
- Modify: `docs/rebuild-blueprint.md`
- Modify: `docs/runbooks/setup-recovery.md`
- Modify: `docs/runbooks/attachment-storage-migration.md`
- Modify: `scripts/operations.test.mjs`

**Interfaces:**

- Documents the exact fresh-deploy and existing-install behavior delivered by
  Tasks 1–7.

- [ ] **Step 1: Update operator documentation**

Document only these initial operator inputs:

```text
INITIAL_ADMIN_EMAIL
INITIAL_ADMIN_PASSWORD
```

Document automatic runtime-key generation, D1/KV requirements, first page
`/login`, independent post-login Cloudflare Mail configuration, and optional
R2 adoption.

- [ ] **Step 2: Update recovery and migration runbooks**

Add exact diagnostics and commands for:

- `release.runtime_secret_state_invalid`;
- `release.legacy_secret_migration_required`;
- failed administrator bootstrap;
- account recovery after build inputs have been removed;
- R2 verification and resumable KV-to-R2 migration.

- [ ] **Step 3: Add operational behavior tests**

Update `scripts/operations.test.mjs` to parse package/Wrangler metadata and
assert:

- no `INSTALLATION_TOKEN`;
- no deploy prompt for signing/encryption keys;
- bootstrap command exists;
- R2 stays optional in the default Wrangler configuration.

- [ ] **Step 4: Run the complete validation matrix**

Run:

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm schema:check
pnpm test
pnpm test:coverage
pnpm db:migrate --target local
pnpm db:verify --target local
pnpm build
pnpm deploy:dry-run
pnpm test:e2e
pnpm audit --prod
git diff --check
```

Expected:

- all commands exit 0;
- coverage retains 100% statements, lines, and functions;
- dry-run lists required D1/KV/Queue/Assets plus required runtime secret names;
- default dry-run does not require R2;
- no output contains supplied test credentials or generated secret values.

- [ ] **Step 5: Perform the completion audit**

Use the design acceptance criteria as a checklist and map each item to:

- a focused test;
- an implementation file;
- a fresh validation command result.

Treat missing Cloudflare production evidence as unverified rather than
inferring success from local dry-run.

- [ ] **Step 6: Commit**

```bash
git add README.md docs scripts/operations.test.mjs
git commit -m "docs: document zero-touch Cloudflare onboarding"
```
