# Changelog

All notable changes to UniMailbox are documented here. The project follows
[Semantic Versioning](https://semver.org/) and uses
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) categories. Release
Please updates released sections from Conventional Commits.

## [Unreleased]

### Added

- AGPL-3.0-only open-source licensing and contributor/security policies.
- Stable distribution, installation adoption, protected production deployment,
  and daily upstream upgrade documentation.
- Domain-level Brevo or Resend provider selection, administrator test delivery
  to a chosen recipient, and managed-domain attribution for provider webhooks.

### Fixed

- First-time Deploy Button installations now provision Cloudflare resources
  with a credential-free minimal deployment. Migrations, administrator setup,
  and runtime secrets use a separate explicit bootstrap command, while release
  verification remains deferred until adoption.

[Unreleased]: https://github.com/UniMailbox/uni-mailbox/commits/main
