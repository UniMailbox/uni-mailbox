# Contributing to UniMailbox

Thank you for improving UniMailbox. Contributions are accepted through the
canonical repository, [`UniMailbox/uni-mailbox`](https://github.com/UniMailbox/uni-mailbox).
The `UniMailbox/unimailbox-deploy` repository is a generated stable distribution
and is not the development target.

## Before opening a change

- Search existing issues and pull requests. For a substantial behavior or data
  model change, open an issue before implementation.
- Report vulnerabilities privately according to [SECURITY.md](SECURITY.md), not
  in a public issue.
- Keep changes focused. Do not commit `.dev.vars`, Cloudflare tokens, generated
  resource IDs, administrator credentials, production data, or release
  artifacts.
- By submitting a contribution, you agree that it is licensed under the
  repository's [AGPL-3.0-only license](LICENSE).

## Development setup

Use the exact versions recorded by the repository: Node 22.22.1, pnpm 10.32.1,
and Wrangler 4.114.0. The complete setup is in
[docs/development.md](docs/development.md).

```bash
pnpm install --frozen-lockfile
cp .dev.vars.example .dev.vars
pnpm scaffold init
pnpm build
```

## Change and test expectations

Use [Conventional Commits](https://www.conventionalcommits.org/) for commit and
pull-request titles. Common prefixes are `feat:`, `fix:`, `docs:`, `test:`,
`refactor:`, and `chore:`. Add `!` and a `BREAKING CHANGE:` footer when a change
requires operator action or breaks a documented contract.

Add focused regression coverage for behavior changes. Before requesting review,
run the checks relevant to the change; the full gate is:

```bash
pnpm format:check
pnpm lint
pnpm i18n:check
pnpm frontend:contracts
pnpm typecheck
pnpm schema:check
pnpm test
pnpm test:coverage
pnpm build
pnpm deploy:dry-run
pnpm deploy:r2:dry-run
```

Run `pnpm test:e2e` for user-visible or browser contract changes. Explain any
check that could not run in the pull request.

## High-risk files

Changes to migrations, release/adoption/update scripts, Wrangler configuration,
and GitHub workflows require maintainer review. In particular:

- Never edit a released migration or its checksum. Add a new migration and its
  compatibility/recovery metadata.
- Keep default and R2 Wrangler bindings in parity; preserve the optional nature
  of R2.
- Never add an installation's Worker name, account ID, D1 ID, KV ID, Queue name,
  R2 bucket, deployment URL, or secret to the canonical source repository.
- Pin GitHub Actions to full commit SHAs. Dependabot is responsible for proposed
  Action and pnpm dependency updates.
- Update tests, operator documentation, and `CHANGELOG.md` when a contract or
  operational procedure changes.

## Release process

Maintainers do not create release tags by hand. Release Please derives a release
pull request from Conventional Commits. Merging that pull request creates the
SemVer tag and GitHub Release; the release workflow then publishes the immutable
stable snapshot to the distribution repository. See
[docs/releases.md](docs/releases.md) for release content and ownership rules.
