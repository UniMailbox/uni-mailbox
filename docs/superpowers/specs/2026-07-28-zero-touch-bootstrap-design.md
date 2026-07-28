# Zero-Touch Cloudflare Bootstrap Design

Date: 2026-07-28

## Summary

UniMailbox will replace its token-claimed, multi-step installation wizard with
a deployment-owned bootstrap. A new deployment will require only an initial
administrator email address and password. D1 and KV remain mandatory
Cloudflare resources. Internal signing and encryption keys will be generated
automatically and stored as Worker secrets.

The deployment will create the first administrator directly in D1 and mark the
installation complete. The deployed application will therefore open at the
login page instead of asking an operator to claim an installation or complete
Cloudflare, domain, provider, and smoke-test checkpoints.

Cloudflare domain and Email Routing configuration, Brevo configuration, and
optional R2 attachment storage will move to authenticated settings workflows.
The administrator email is an application login identifier only. It does not
create or bind a mailbox, email address, domain, or Email Routing rule.

## Goals

- Require only an initial administrator email and password from the operator.
- Generate runtime cryptographic keys without asking the operator to invent,
  copy, or paste random tokens.
- Create the first administrator during deployment and make the first browser
  interaction a normal login.
- Keep D1 and KV as mandatory infrastructure and fail deployment if either is
  unavailable.
- Move Cloudflare mail configuration and optional R2 adoption behind
  authenticated administrator settings.
- Make deployment idempotent: subsequent releases must not reset the
  administrator or rotate cryptographic keys.
- Preserve the ability to use the existing KV attachment backend when R2 is
  absent.
- Prevent secret values and the initial password from appearing in source,
  generated artifacts, command arguments, or release logs.

## Non-Goals

- Public self-registration during bootstrap.
- Creating an application mailbox from the administrator login email.
- Requiring R2 for the first release.
- Automatically enabling a Cloudflare domain or Email Routing before the
  administrator can log in.
- Automatically rotating established runtime keys.
- Silently migrating an existing installation from an unknown legacy
  encryption key.

## Current State

The current installation state machine begins at `claim` and requires
`INSTALLATION_TOKEN`, `AUTH_SIGNING_KEY`, and
`CREDENTIAL_ENCRYPTION_KEY` bindings before the Worker can construct its
application context. The browser exchanges the installation token for a
short-lived setup session and then completes preflight, administrator,
Cloudflare, domain, inbound smoke-test, Brevo, outbound smoke-test, and
completion steps.

This has three undesirable consequences:

1. Operators must invent and transport secrets that the application can
   generate safely.
2. A valid administrator cannot log in until unrelated mail-provider and
   infrastructure-extension work is complete.
3. Candidate metadata, setup-session state, and external integration checks
   become startup dependencies.

## Target Lifecycle

```text
Cloudflare deployment form
  -> D1 and KV provisioning
  -> database migrations
  -> runtime secret reconciliation
  -> first-administrator bootstrap
  -> Worker deployment
  -> /login
  -> authenticated Settings configuration
```

The installation state visible to the runtime becomes:

```text
admin_bootstrap -> complete
```

The release process performs `admin_bootstrap`. Ordinary Worker requests only
observe the resulting state; they do not own first-administrator creation.

## Deployment Inputs

### Operator-provided, build-only inputs

- `INITIAL_ADMIN_EMAIL`
  - Cloudflare Workers Builds variable.
  - Normalized to lowercase after trimming.
  - Used only when no administrator exists.
- `INITIAL_ADMIN_PASSWORD`
  - Cloudflare Workers Builds secret.
  - Minimum 12 characters and maximum 1024 characters.
  - Used only when no administrator exists.

These values must not be Worker runtime bindings. Workers Builds exposes them
only to the deployment command. The password is converted to a salted
PBKDF2-SHA256 record before any database write. Only the hash, salt,
algorithm, and iteration count are stored.

After a successful bootstrap, the two build inputs may be removed from the
Cloudflare build trigger. Later releases do not require them when an
administrator already exists.

### Automatically generated runtime secrets

- `AUTH_SIGNING_KEY`
- `CREDENTIAL_ENCRYPTION_KEY`

The release process generates 32 cryptographically random bytes for each
missing secret and encodes them as base64url. It uploads new values with
Wrangler's `--secrets-file` mechanism so values do not appear in process
arguments or logs.

The release process follows these invariants:

- Existing secret values are never read or printed.
- Omitted secrets remain unchanged in later Worker versions.
- Missing secrets are generated only when the remote binding state was read
  successfully and proves that the secret is absent.
- An unknown, malformed, or inaccessible remote secret state stops the release.
- Normal releases never rotate either secret.
- Temporary secret files live under the ignored `.wrangler/release` directory,
  use restrictive permissions, and are removed on both success and failure.

`INSTALLATION_TOKEN` is removed from the runtime contract, deployment
template, local development template, package metadata, documentation, and
tests.

## Mandatory Cloudflare Resources

The following resources must exist before administrator bootstrap:

- D1 binding `DB`
- KV binding `KV`
- Queue binding `OUTBOUND_QUEUE`
- static asset binding `ASSETS`

The release preflight verifies D1 schema and migration checksums, verifies KV
access using a namespaced short-lived probe, and checks the declared queue and
asset bindings through the Wrangler artifact inspection already used by the
release pipeline.

R2 binding `ATTACHMENTS` is explicitly optional. Its absence selects the KV
attachment backend and does not degrade installation or login health.

## First-Administrator Bootstrap

The release runs the bootstrap after production migrations and D1 schema
verification, but before promoting the new Worker version.

The bootstrap algorithm is:

1. Query for a user assigned the seeded administrator role.
2. If an administrator exists:
   - return success without reading the initial email or password;
   - do not modify the account, roles, password, sessions, or recovery codes;
   - ensure installation state is `complete`.
3. If no administrator exists:
   - require and validate both initial build inputs;
   - normalize the email independently of mail-domain configuration;
   - hash the password with a random 16-byte salt and the application PBKDF2
     policy;
   - create the user and administrator role assignment;
   - mark installation state `complete`;
   - commit all writes atomically.
4. If any write fails, roll back every bootstrap write and stop before Worker
   promotion.

The bootstrap emits only structural diagnostics:

- whether an existing administrator was found;
- whether a new administrator was created;
- the resulting installation state;
- a request/build identifier.

It never emits the email, password, hashes, salts, runtime keys, SQL literals,
or encrypted credential payloads.

Recovery codes are generated from an authenticated account-security screen
after the first login. They are not printed into build logs.

## Runtime Routing

- If the installation is complete and the request is `/setup`, redirect:
  - unauthenticated users to `/login`;
  - authenticated administrators to `/settings`.
- If bootstrap did not complete, ordinary application routes return a
  deployment-incomplete page with a request ID. They do not expose a public
  administrator-creation endpoint.
- `/api/v1/setup/claim`, `/api/v1/setup/preflight`, and the unauthenticated
  setup mutation surface are removed.
- Authenticated repair and settings operations remain protected by
  `settings.manage`.

The login page continues to accept email and password. The login email has no
foreign key or implicit mapping to mailbox addresses, managed domains, or
provider identities.

## Authenticated Settings

The settings experience presents four independent sections.

### Required infrastructure

This section reports read-only health for D1, KV, Queue, and static assets.
Missing mandatory bindings are deployment faults, not wizard steps, and cannot
be deleted from the application UI.

### Cloudflare Mail

The administrator can:

- connect a Cloudflare account through supported OAuth or a dashboard-assisted
  path;
- select an account, zone, and managed mail domain;
- inspect required DNS records;
- configure or verify Email Routing to the Worker;
- run and retry an inbound smoke test.

Failures remain local to this section and never disable login or unrelated
settings.

### Outbound provider

The administrator can configure Brevo, encrypt its credentials with
`CREDENTIAL_ENCRYPTION_KEY`, and run an outbound smoke test. Provider
connection state is independent of installation completion.

### Optional R2 attachment storage

The administrator can:

- create or select an R2 bucket through an authorized Cloudflare connection,
  or follow a dashboard-assisted binding path;
- verify the `ATTACHMENTS` binding;
- start the existing resumable KV-to-R2 migration;
- monitor copied, verified, failed, and remaining object counts.

Until the binding is verified, KV remains the active attachment backend.
Enabling R2 does not delete KV objects. Deletion requires a separately
approved cleanup phase after migration verification.

## Account Changes After Installation

An authenticated administrator can change the login email and password in
account security settings.

- Changing the login email updates only identity data.
- Changing the password requires the current password.
- A successful password change revokes all other refresh-token sessions.
- The current browser receives a newly issued session.
- Bootstrap build variables are never consulted after an administrator exists.

## Existing Installation Compatibility

An established `AUTH_SIGNING_KEY` or `CREDENTIAL_ENCRYPTION_KEY` must not be
replaced merely because the new deployment template changes how new
installations provision secrets.

The release performs a compatibility audit before changing binding mode:

1. Inspect the currently deployed binding types.
2. Inspect whether `encrypted_credentials` contains data.
3. Preserve supported existing bindings unchanged when their values remain
   available to the new Worker version.
4. If an encryption binding would be removed or replaced while encrypted data
   exists, stop with `LEGACY_SECRET_MIGRATION_REQUIRED`.
5. Run key migration only through an explicit migration command that makes old
   and new keys available to one controlled migration version, decrypts and
   re-encrypts each credential, verifies every record, and records completion.

The normal production release never guesses that an existing installation is
empty and never treats a missing binding parse result as permission to rotate.

Existing installations that already have an administrator but remain on a
legacy setup step are advanced to `complete` without changing that
administrator. Their unfinished Cloudflare, domain, provider, and smoke-test
checkpoints become authenticated settings tasks.

## Failure Handling

| Failure                                                 | Required behavior                                          |
| ------------------------------------------------------- | ---------------------------------------------------------- |
| D1 or KV was not provisioned                            | Stop before bootstrap and Worker promotion                 |
| Migration or schema verification failed                 | Stop before bootstrap                                      |
| Initial email or password missing on a new installation | Stop with a redacted configuration error                   |
| Initial input is invalid                                | Stop with field-level structural diagnostics and no values |
| Runtime secret is confirmed absent                      | Generate it once and upload it securely                    |
| Runtime secret state is unknown                         | Stop; do not generate or rotate                            |
| Existing administrator found                            | Treat bootstrap as an idempotent success                   |
| Bootstrap transaction failed                            | Roll back all bootstrap writes                             |
| Existing encrypted data would lose its key              | Stop with `LEGACY_SECRET_MIGRATION_REQUIRED`               |
| Cloudflare Mail setup failed after login                | Keep login and other settings available                    |
| R2 is absent or its migration failed                    | Continue using KV; preserve source objects                 |

## Testing Strategy

### Release unit tests

- A new installation generates each missing runtime key once.
- A subsequent deployment omits and preserves established secrets.
- Unknown secret-list output stops the release.
- Temporary files are removed on success and failure.
- Diagnostic output redacts initial credentials and generated secrets.
- Existing administrators make initial build variables optional.

### Bootstrap integration tests

- Missing initial inputs reject a database with no administrator.
- Invalid email and short passwords are rejected.
- Bootstrap creates one administrator with the expected password algorithm and
  role.
- Login succeeds with the initial credentials after bootstrap.
- Re-running bootstrap does not change the password record or create another
  administrator.
- A failure between user, role, and installation-state writes leaves no
  partial administrator.
- An existing administrator on a legacy setup step advances to `complete`.

### Worker tests

- A completed installation serves `/login`.
- `/setup` redirects unauthenticated users to `/login`.
- Removed unauthenticated setup endpoints return `404`.
- The login email remains independent from mailboxes and domains.
- Missing R2 keeps the KV backend healthy.

### Settings tests

- Required-resource health is read-only.
- Cloudflare Mail, Brevo, and R2 errors are isolated.
- Enabling R2 requires a verified binding.
- KV-to-R2 migration remains resumable and preserves KV source objects.
- Login email and password changes require authorization and revoke other
  sessions.

### End-to-end tests

- First deployment bootstrap followed by administrator login.
- Redeployment preserves administrator credentials and runtime keys.
- Login followed by Cloudflare domain and Email Routing configuration.
- Optional R2 adoption followed by verified KV-to-R2 migration.
- Account email and password change followed by rejection of old credentials
  and other sessions.

## Rollout Sequence

1. Add redacted release helpers and tests for secret reconciliation and
   administrator bootstrap.
2. Add the idempotent D1 bootstrap command and transaction.
3. Simplify installation state and remove the claim route and UI.
4. Move Cloudflare, domain, provider, smoke-test, and R2 flows into
   authenticated settings.
5. Add compatibility checks for legacy secrets and incomplete setup states.
6. Update the deployment template, examples, runbooks, and end-to-end tests.
7. Validate a fresh Cloudflare deployment and an existing-installation
   redeployment before promoting the change to the seed repository.

## Acceptance Criteria

- A fresh Cloudflare deployment asks the operator only for the initial
  administrator email and password.
- The operator never supplies installation, signing, or encryption tokens.
- D1 and KV are provisioned and verified before bootstrap.
- The first administrator is persisted before Worker promotion.
- The first application page is login, and the supplied credentials work.
- The login email creates no mailbox or domain side effects.
- Repeated deployments preserve the administrator and all established keys.
- Cloudflare Mail and optional R2 configuration are available after login and
  do not gate application startup.
- Every secret-bearing path is redacted, idempotent, and covered by focused
  tests.
