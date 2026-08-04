# Changelog

All notable changes to UniMailbox are documented here. The project follows
[Semantic Versioning](https://semver.org/) and uses
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) categories. Release
Please updates released sections from Conventional Commits.

## [0.2.0](https://github.com/UniMailbox/uni-mailbox/compare/v0.1.0...v0.2.0) (2026-08-04)


### Features

* add cloudflare deploy workflow and setup guide ([56bc09f](https://github.com/UniMailbox/uni-mailbox/commit/56bc09f03b777357f5aa5a47c4d7881ca135c40f))
* add stable release distribution ([54499d4](https://github.com/UniMailbox/uni-mailbox/commit/54499d4a37ec5bf6bacd8fa921d20854cf87b834))
* **admin:** adopt typed localized administration ([fba78a6](https://github.com/UniMailbox/uni-mailbox/commit/fba78a69923264cc6e7dca1ef7cfe922e8c0caf0))
* **admin:** move table actions into dialogs ([74f2795](https://github.com/UniMailbox/uni-mailbox/commit/74f2795b8801a872097de63789af1ff33dec41ef))
* **api:** add typed frontend transport ([5dc1484](https://github.com/UniMailbox/uni-mailbox/commit/5dc1484be371ef55d43ee305dccb698f7589f5cb))
* **deploy:** automate zero-touch bootstrap ([beb2bbd](https://github.com/UniMailbox/uni-mailbox/commit/beb2bbdf6396ce1759ced0e0dfd56a812edfd793))
* **deploy:** bootstrap the first administrator ([763f0e3](https://github.com/UniMailbox/uni-mailbox/commit/763f0e3b92bf13a28147329bcabd3023332f0b1b))
* **deploy:** reconcile bootstrap secrets safely ([2ea7987](https://github.com/UniMailbox/uni-mailbox/commit/2ea79871c5e8bcb8a4b03bbb20e6c1b6341e9d18))
* expand administration message and attachment controls ([5d30535](https://github.com/UniMailbox/uni-mailbox/commit/5d30535b333071bab1ad009c580433cd4121ad31))
* harden runtime and local development ([5846cd8](https://github.com/UniMailbox/uni-mailbox/commit/5846cd8a0d81582c7dcb94a923a673f99865b091))
* **mail:** centralize typed mail data ([e08f7fc](https://github.com/UniMailbox/uni-mailbox/commit/e08f7fc360ce660b4d322bf3ea53131643fee22b))
* **mail:** localize compose workflows ([a785360](https://github.com/UniMailbox/uni-mailbox/commit/a7853601d9a864e1161519f54d5cc7b289574ee8))
* **mail:** migrate compose form state ([6dc717b](https://github.com/UniMailbox/uni-mailbox/commit/6dc717b7839d2147fef29b715b06f837cadf68dd))
* **provider:** add domain-level delivery configuration ([617f636](https://github.com/UniMailbox/uni-mailbox/commit/617f636bc6583916cf1176bf47e4856f87605e7e))
* rebuild unimailbox as a single Cloudflare Worker with feature folders and 99%+ coverage ([4099f8c](https://github.com/UniMailbox/uni-mailbox/commit/4099f8cb9f076ed2f90e6018c079910bd5c6a4f1))
* scaffold cloudflare full-stack starter ([d848805](https://github.com/UniMailbox/uni-mailbox/commit/d8488054230c126730078bffc8ca5097db24d097))
* **settings:** add localized typed preferences ([f297b95](https://github.com/UniMailbox/uni-mailbox/commit/f297b9561819578137b6c7d4e0d532ea0b4202ec))
* **settings:** replace setup with authenticated configuration ([23f546d](https://github.com/UniMailbox/uni-mailbox/commit/23f546d1b240f95daa25c64f35b4139794d813e9))
* **settings:** replace setup wizard with admin settings ([422e108](https://github.com/UniMailbox/uni-mailbox/commit/422e1082f8d754dc7de3e368c5867a2233475185))
* **storage:** add R2 overlay config and KV-to-R2 migration runbook ([d326567](https://github.com/UniMailbox/uni-mailbox/commit/d3265673d13007327be2ae231ee3bddf35af680d))
* **storage:** default attachments to KV with auto-detected R2 backend ([6963853](https://github.com/UniMailbox/uni-mailbox/commit/6963853269b7214bbe0a4ef3c0d703dabcf0dcf6))
* unify navigation and add Sentry monitoring ([f7d541e](https://github.com/UniMailbox/uni-mailbox/commit/f7d541ea93eb1d8d480cc5f6bd816161dcd51fb2))
* **web:** add customizable theme color ([d7b8726](https://github.com/UniMailbox/uni-mailbox/commit/d7b8726712a72cea521675daed507e4cf7fd3724))
* **web:** add direction-safe localized layout ([7f1a91c](https://github.com/UniMailbox/uni-mailbox/commit/7f1a91c85daad8c17f71cac6c51bd6d45d4afbb9))
* **web:** add locale runtime ([4a88de3](https://github.com/UniMailbox/uni-mailbox/commit/4a88de3b4a8308e9fda6a498dedc6656caeb9ca2))
* **web:** add regional preferences and user menu ([7337728](https://github.com/UniMailbox/uni-mailbox/commit/73377285ab2bad06891048e95edc1a50b86a9079))
* **web:** adopt typed application routing ([be66d97](https://github.com/UniMailbox/uni-mailbox/commit/be66d97dff7a4455e3d07b6eef33f2ce8477e4f8))
* **web:** localize client and form errors ([1d5ebb6](https://github.com/UniMailbox/uni-mailbox/commit/1d5ebb61f7f294b09216c51425ec986ba506620a))
* **web:** make sidebar collapsible with independent scroll and submenu toggles ([7178063](https://github.com/UniMailbox/uni-mailbox/commit/71780632db2880688ec0124d72f72140af2b3e5e))
* **web:** show styled tooltip with label while sidebar is collapsed ([271a09d](https://github.com/UniMailbox/uni-mailbox/commit/271a09d47f305bf88e7703ff541112defa68fba0))
* **worker:** report scheduled-trigger health via a status heartbeat ([291fcd2](https://github.com/UniMailbox/uni-mailbox/commit/291fcd2e244ca891b2d68d6d03268c79307bec07))


### Bug Fixes

* **admin:** address review findings ([74a25be](https://github.com/UniMailbox/uni-mailbox/commit/74a25be1efc28a5c8d96d83d400b39799c9d4cc8))
* **admin:** isolate domain hostname input ([500b0aa](https://github.com/UniMailbox/uni-mailbox/commit/500b0aadf34d5681deebd1bc7e5b9155bd37e1e1))
* **api:** decode binary and redirect responses ([9aa6f80](https://github.com/UniMailbox/uni-mailbox/commit/9aa6f80b72a4204e62f1d7ba6adb696105120a0c))
* **api:** encode binary attachment upload bodies ([13e59e6](https://github.com/UniMailbox/uni-mailbox/commit/13e59e63c0e6328f63cddbf7e40567d6c0696d4e))
* **api:** preserve redirect responses ([c013427](https://github.com/UniMailbox/uni-mailbox/commit/c0134274a1bdcc85351c8374cb015de28d68e8ee))
* **cloudflare:** guide manual domain routing ([ad9c158](https://github.com/UniMailbox/uni-mailbox/commit/ad9c158d74dbd0ae337fef6cb60cb3be6a8a24e3))
* **deploy:** bootstrap before candidate verification ([d126fe7](https://github.com/UniMailbox/uni-mailbox/commit/d126fe716971e10859223196926d8312efa60677))
* **deploy:** bootstrap initial D1 schema atomically ([a1b50fe](https://github.com/UniMailbox/uni-mailbox/commit/a1b50fec3bba62899d7572d14d94d29b1275afe0))
* **deploy:** fall back when version metadata is missing ([30c1ac4](https://github.com/UniMailbox/uni-mailbox/commit/30c1ac4d63c5cc17c94fc1b291ab8c6c5e2355d3))
* **deploy:** fall back when version metadata is missing ([b9a0ee6](https://github.com/UniMailbox/uni-mailbox/commit/b9a0ee6f2af8459902955635fee53aa074afb51f))
* **deploy:** handle Wrangler version output in Workers Builds ([5d92328](https://github.com/UniMailbox/uni-mailbox/commit/5d9232849b0a3344ab86efb7efe94cbaf5d42713))
* **deploy:** harden bootstrap and login recovery ([9172dce](https://github.com/UniMailbox/uni-mailbox/commit/9172dce3f50f159a32affe43830eb3ae60a7911d))
* **mail:** map draft and reply errors ([e295d7d](https://github.com/UniMailbox/uni-mailbox/commit/e295d7d942c4954e96ea6798992ed94df9485d61))
* **mail:** preserve recovered draft lifecycle ([8d02c50](https://github.com/UniMailbox/uni-mailbox/commit/8d02c50f612f7af7edfa4fd55ab53a4b94d5ef01))
* **mail:** wait for draft recovery before autosave ([325bd62](https://github.com/UniMailbox/uni-mailbox/commit/325bd622e1a498cca5d34c8be0f8c8bc1220ac69))
* **migrations:** verify remote D1 queries ([6fcdc8c](https://github.com/UniMailbox/uni-mailbox/commit/6fcdc8c6efaade9daf0f8f77be6253ec52c16ed1))
* **settings:** align protected endpoint contracts ([7828ffe](https://github.com/UniMailbox/uni-mailbox/commit/7828ffee6f81085d1e7cf5d7c069bb794116b1f4))
* **settings:** restore OAuth and form validation ([3a480b0](https://github.com/UniMailbox/uni-mailbox/commit/3a480b072b496133d7e7dbf0df9fd274b7eab1c0))
* **storage:** harden KV-to-R2 migration and fallback ([9f9bcc5](https://github.com/UniMailbox/uni-mailbox/commit/9f9bcc51bccb87c1d378b47c3340dcbe2bc19779))
* **web:** guard settings and contract attachment uploads ([d7bf164](https://github.com/UniMailbox/uni-mailbox/commit/d7bf1643af18d1607e7267a33ad44eb9bb6843f0))
* **web:** harden form submission validation ([3381c93](https://github.com/UniMailbox/uni-mailbox/commit/3381c938fd64030902f5c03b5a109340b475f1b7))
* **web:** harden localized form errors ([01d3935](https://github.com/UniMailbox/uni-mailbox/commit/01d3935588df349e6628f256e887befa9bdf226d))
* **web:** isolate technical rtl form values ([e9e92fa](https://github.com/UniMailbox/uni-mailbox/commit/e9e92faf34da76bb6129d90f29c268f4d2199409))
* **web:** restore guarded settings routing ([d6be827](https://github.com/UniMailbox/uni-mailbox/commit/d6be8279bbd97d48d43f60f6dfa22a6fab001838))


### Performance Improvements

* **worker:** collapse KV attachment metadata into the body key ([df18f3d](https://github.com/UniMailbox/uni-mailbox/commit/df18f3d98edd490c2cf8834e7a0a17b513f3d8ca))

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
