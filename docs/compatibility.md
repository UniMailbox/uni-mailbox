# Compatibility and maintenance policy

This policy defines which UniMailbox combinations are maintained and what an
operator may rely on during an upgrade. A release's notes may narrow a boundary
for a documented security or platform reason, but may not silently widen it.

## Versioning

UniMailbox publishes one application version using Semantic Versioning. Git
tags use `vMAJOR.MINOR.PATCH`; runtime metadata and package metadata use
`MAJOR.MINOR.PATCH` without the `v` prefix.

- Patch releases contain backward-compatible fixes and dependency updates.
- Minor releases contain backward-compatible features. While the project is
  below `1.0.0`, a minor release may include a breaking change only when its
  release notes mark it prominently and provide an upgrade procedure.
- Major releases may intentionally break documented application, deployment, or
  data contracts.

Only immutable GitHub Releases are stable. The canonical and distribution
repositories' `main` branches are development/distribution inputs, not update
channels.

## Supported window

The latest stable release receives fixes. The immediately preceding stable
release remains a supported upgrade source until the next stable release, so
the release gate can exercise its database and configuration transition.
Operators on an older version must follow the intermediate release notes unless
a newer release explicitly declares and tests a direct upgrade from their
version.

Each GitHub Release must state:

- the minimum source version from which direct upgrade is supported;
- the minimum Node, pnpm, and Wrangler versions;
- every new D1 migration and whether a data backfill is required;
- binding, permission, secret, Environment, and configuration changes;
- breaking changes, manual actions, and rollback/fix-forward guidance; and
- any Cloudflare platform or paid-plan prerequisite.

## Database compatibility

Released D1 migrations and checksums are immutable. Schema changes use an
expand/migrate/contract sequence where practical:

1. add structures that old and new Workers can tolerate;
2. migrate and verify data without deleting the previous representation; and
3. remove obsolete structures only in a later release whose notes require the
   operator's explicit approval.

A production release records a D1 Time Travel bookmark before migration, but an
automatic rollback changes only the Worker version. D1 recovery is a separate,
approved incident action; after an ordinary failed release, database changes are
handled fix-forward.

## Installation configuration compatibility

The installation repository owns its Worker name, Cloudflare account, D1 name
and ID, KV namespace ID, Queue names, optional R2 bucket, and deployment URL.
Stable upgrade merges must preserve these values while accepting upstream
bindings, compatibility dates, scripts, dependencies, and security settings.

The default `wrangler.jsonc` and optional `wrangler.r2.jsonc` overlay must expose
the same non-R2 application contract. A release that adds or changes a binding
must update both configurations, configuration parity tests, adoption checks,
and release notes.

## Application and API compatibility

The Worker and web application are released and deployed as one artifact. Mixing
their versions is unsupported. Documented `/api/v1` request/response contracts
remain backward compatible within a major release unless a pre-1.0 minor release
is explicitly marked breaking. Database contents, encrypted values, Queue
messages, and attachment object keys must remain readable across every supported
upgrade path.

Cloudflare APIs and third-party provider behavior are external contracts. When a
platform change cannot be hidden behind a compatible release, the release notes
must identify the new prerequisite and a verification procedure.

## End-of-life changes

Removing a backend, provider, API contract, binding, or supported upgrade source
requires advance notice in at least one stable release when security does not
require immediate removal. The notice must identify the last supported release,
replacement path, required data migration, and effective removal version.
