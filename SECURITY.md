# Security policy

## Supported versions

Security fixes are released on the latest stable SemVer release. When a fix
requires a migration or minimum upgrade baseline, the GitHub Release and
[compatibility policy](docs/compatibility.md) state that boundary explicitly.
Development branches and unreleased distribution snapshots are not supported
production versions.

## Report a vulnerability privately

Do not open a public issue, discussion, or pull request for an undisclosed
vulnerability. Use
[GitHub private vulnerability reporting](https://github.com/UniMailbox/uni-mailbox/security/advisories/new)
and include:

- the affected release and deployment mode;
- impact and realistic attack preconditions;
- reproducible steps or a minimal proof of concept;
- relevant logs with tokens, credentials, message contents, account IDs, and
  personal data removed; and
- any mitigation already tested.

If private vulnerability reporting is unavailable, contact a repository owner
through their verified GitHub profile and request a private reporting channel.
Do not send secrets in the initial message.

Maintainers will acknowledge the report, validate scope, coordinate a fix and
release, and credit the reporter if requested and appropriate. Response and fix
timing depends on severity and reproducibility; no fixed service-level agreement
is promised by this community project.

## Operator security responsibilities

Every installation is independently operated. Operators must:

- use a Cloudflare API token scoped to the single installation account and only
  the Worker, D1, KV, Queue, and optional R2 permissions in use;
- store Cloudflare credentials only in the protected GitHub `production`
  Environment;
- remove `INITIAL_ADMIN_EMAIL` and `INITIAL_ADMIN_PASSWORD` from Workers Builds
  after successful bootstrap;
- disable Workers Builds production auto-deployment after adoption;
- require a reviewer, prevent self-review, and disallow administrator bypass for
  the production Environment;
- rotate any token or password exposed in logs, issues, chat, commits, or build
  output immediately; and
- keep the deployed stable release and dependencies within the supported window.

The canonical source and distribution repositories must never contain a real
installation token, account ID, resource ID, initial password, production
message, or release manifest copied from an installation.

## Disclosure and license

Please allow maintainers a reasonable opportunity to release a fix before
public disclosure. UniMailbox is provided without warranty under
[AGPL-3.0-only](LICENSE); review the license for the complete terms, including
the source-availability obligation for modified network services.
