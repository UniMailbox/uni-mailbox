# Release and distribution policy

UniMailbox separates development from stable installation distribution:

```text
UniMailbox/uni-mailbox
  -> SemVer GitHub Release
  -> UniMailbox/unimailbox-deploy immutable snapshot and matching tag
  -> installer-owned repository
  -> reviewed upstream upgrade pull request
  -> manually approved production deployment
```

## Repository responsibilities

`UniMailbox/uni-mailbox` is canonical. It owns development, CI, source history,
release notes, and the AGPL-3.0-only source. It does not contain Cloudflare
production credentials or installation resource IDs and does not deploy an
installer's production Worker.

`UniMailbox/unimailbox-deploy` is public distribution. Its `main` branch is the
latest stable deployment snapshot, and every stable snapshot has an immutable
tag matching the canonical release. It contains the Deploy Button contract,
adoption gate, production workflow, and stable updater copied into new
installation repositories.

An installer-owned repository retains its own source changes and generated
Cloudflare configuration. It receives upgrade pull requests but never deploys
an upgrade merely because a pull request was opened or merged.

## Creating a stable release

Release Please derives a release pull request from Conventional Commits. The
release pull request updates the single application version and changelog.
Merging it creates `vX.Y.Z` and the canonical GitHub Release. Maintainers must
not repoint or recreate a published stable tag.

Before merge, the release description must include:

- a human-readable change summary and breaking changes;
- all included D1 migrations and backfills;
- the minimum supported source version and direct-upgrade path;
- the minimum Node, pnpm, and Wrangler versions;
- binding, permission, secret, and GitHub Environment changes;
- operator actions, known limitations, and compatibility notes; and
- Worker rollback and D1 fix-forward/recovery guidance.

The canonical release workflow uses a dedicated GitHub App installation token
to export the exact tagged source to the distribution repository. It must not
use a personal access token or copy canonical Git history. The snapshot records
`.unimailbox/upstream.json` with schema version, canonical and distribution
repositories, stable channel, application version, tag, and canonical source
commit. The workflow verifies that metadata before creating the matching
distribution tag.

## Distribution and upgrade guarantees

The distribution repository publishes only successful stable releases, never a
moving canonical branch or release candidate. An installation updater resolves
the latest canonical GitHub Release and fetches its matching immutable
distribution tag, using the installed distribution tag as its merge base.
Installation-owned resource identifiers always win the
structured configuration merge; upstream source changes use a normal three-way
merge.

An updater may open a pull request only after dependency installation,
repository doctor, migration checksum, typecheck, test, configuration parity,
and deployment dry-run checks pass. A true merge conflict creates or updates an
issue and leaves `main` unchanged.

## Production authority and failures

Cloudflare Workers Builds owns the first Deploy Button installation only. After
`pnpm deployment:adopt`, the installer disables its production auto-deployment.
The sole long-term production authority is the manually dispatched GitHub
Actions workflow protected by the `production` Environment.

The first-install `pnpm deploy` command performs only a credential-free direct
deployment and does not query remote resources. The installer then runs
`pnpm deployment:bootstrap` explicitly to apply migrations, create the
administrator, and attach missing runtime secrets. The protected workflow owns
release-candidate and health verification gates only after adoption.

The workflow retains the D1 bookmark and release manifest as artifacts. A failed
post-deployment HTTP smoke test may automatically restore the previous Worker
version. It must not automatically restore D1; migrations remain fix-forward
unless an operator separately approves database recovery.

See [deployment.md](deployment.md) for installer setup and
[compatibility.md](compatibility.md) for supported upgrade boundaries.
