# UniMailbox（统一邮箱）

UniMailbox 是一个自托管的邮件运营工作区，整体作为一个 Cloudflare Worker
部署运行。它接收通过 Email Routing 转发的邮件，将规范化后的消息数据存放到
D1 与 KV（可叠加 R2），并通过按域名选择的 Brevo 或 Resend provider 将邮件
投递到外部收件人，同时在同一域名为 React 前端应用提供服务。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/UniMailbox/unimailbox-deploy)

[English](README.md) · [简体中文](README.zh-CN.md)

Deploy to Cloudflare 按钮会从 [`UniMailbox/unimailbox-deploy`](https://github.com/UniMailbox/unimailbox-deploy)
安装最新的稳定快照。Cloudflare 会在你的 GitHub 账户中创建一个独立仓库，并写入
该次安装对应的 Worker、D1、KV 与 Queue 配置。它并不是本仓库的 fork；在接受
上游升级时请保留它生成出来的资源标识符。

## 已实现功能

### 邮件投递管线

- **入站**——Cloudflare Email Routing 事件触发 `postal-mime` 解析器；规范化
  后的消息写入 D1，并经过速率限制与屏蔽列表两道闸门。无法识别收件人的策略
  可按环境配置为 `reject` 或 `store`。
- **出站**——`OUTBOUND_QUEUE`（`unimailbox-outbound` 加 DLQ）承载具备 retry
  能力的 durable 出站任务，最多重试 5 次，通过 `lock_token` 恢复，并使用
  `Idempotency-Key` 防止重复发送。
- **Webhook**——`POST /api/v1/webhooks/:providerKey/:connectionId` 负责校验
  Svix 签名、按 `(connection, event_key)` 通过原子认领去重，并按确定性的顺序
  应用 provider 的状态事件。
- **Provider**——Brevo 和 Resend 适配器保持 provider 中立；通过
  `domains.outbound_connection_id` 按域名选择 provider；每个连接都支持测试
  投递与入站/出站烟囱测试。

### 撰写

- **富文本撰写器**——TipTap（`StarterKit` + `Placeholder`）生成的内容经
  DOMPurify 净化后送入 worker；回复时把父邮件包裹在
  `<blockquote data-parent-message>` 中，并在主题前加上 `Re:`。
- **草稿**——服务端草稿以 `If-Match` ETag 实现乐观并发；工作中草稿通过
  Dexie 持久化到 IndexedDB，下次进入页面会自动 hydrate；发送请求附带 UUID
  `Idempotency-Key`。
- **附件**——三段式上传（`createUpload` → 签名 URL 直接上传 → `complete`）。
  默认后端为 KV；通过 `ATTACHMENTS` binding 自动探测 R2。下载支持 `Range`；
  `attachment_files` 目录按 `md5` 做内容寻址去重。

### 邮箱组织

- **文件夹**——`inbox` / `sent` / `drafts` / `archive` / `trash` 五大文件夹，
  加上虚拟的 `starred` 视图；游标分页，`limit ∈ [1, 100]`；支持标记已读、
  加星、移动与删除。
- **邮箱共享与 RBAC**——多用户邮箱支持 `viewer` / `sender` / `admin` 三种
  共享角色；位掩码 `permissions` 与 `role_permissions` 在每一个
  `/api/v1/admin/*` 路由上解析授权；`registration_keys` 支持邀请制注册；
  OAuth 账户绑定支持 Cloudflare。
- **Bootstrap 引导**——`installation_state` 跟踪五个安装步骤；在
  `InstallationStep.COMPLETE` 之前，除 `/health`、`/setup` 与
  `/api/v1/setup/*` 之外的所有路径都会返回 `503 BOOTSTRAP_INCOMPLETE`。

### 管理控制平面

单个 `AdminPage` 覆盖 11 项资源，所有操作都放在具备焦点陷阱的 dialog 中：

- **Users / Roles / Domains / Provider Connections**——CRUD，覆盖状态、角色
  绑定以及按域名的 provider 投递配置。
- **Cloudflare**——OAuth start / callback / revoke，跳转到 Email Routing /
  DNS / Worker 后台的 dashboard 链接，手动域名路由引导，以及入站/出站烟囱
  测试。
- **Storage**——D1 / KV / R2 资源就绪状态卡；KV ↔ R2 附件后端验证。
- **Settings**——站点标题、注册开关、邀请要求、入/出站开关、
  `unknown_recipient_policy`、附件与邮箱配额，以及发件人/主题/内容屏蔽列表。
- **Signatures**——按域名的 HTML / text 签名及 `enabled` 标志位。
- **Webhooks / Audit / Analytics / Messages / Attachments**——以只读为主的
  表格，支持关键词搜索，附件支持图片与 PDF 内嵌预览，消息审计覆盖所有邮箱
  及其附件。

### 可观测性

- **Sentry**——Worker 端（`@sentry/cloudflare`）与浏览器端（`sentry/react`）
  共享同一个 release；队列、调度器和路由错误都附带 `requestId` 上报。
- **心跳**——每分钟、每小时和每日 `03:17 UTC` 的 Scheduled trigger 会把健康
  状态写入 D1；KV 固定窗口速率限制器是所有端点统一使用的原语。
- **日志**——结构化 `logger`，按 `requestId` 串联请求；告警与恢复流程收录在
  `.skills/runbooks/observability-alerts.md`。

### 国际化与无障碍

- **三种 locale**——`en` 与 `zh-CN` 进入生产；`ar-XB` 是仅用于测试的伪本地化
  locale，用来覆盖 RTL 场景。
- **方向安全**——`<BidiText kind="identifier" dir="ltr">` 隔离用户提供的文本；
  技术字段（id、API key、webhook secret 等）绕过本地化，强制使用 `dir="ltr"`。
- **主题**——自定义 HSL 调色板从一个输入颜色派生出 `forest / forestDeep /
mint / focus / focusSoft`，结果持久化到 `localStorage`，并写入
  `<meta name="theme-color">`。
- **无障碍**——每个图标按钮都带 `aria-label`；路由边界会把错误与 403 导向
  专门的、由 Sentry 打标的组件。

### 类型化契约

- **`@unimailbox/contracts`**——为每个 API 端点提供 Zod 3 schemas，由 worker
  与 web 共享；前端 API 客户端会再次校验响应，并在不一致时抛出
  `CLIENT_RESPONSE_INVALID`，附上原始 payload 与 `requestId`。
- **自动刷新**——`lib/api/transport` 在遇到 `401` 时发起一次
  `POST /auth/refresh`，原请求重放一次；否则清空会话。
- **错误归一化**——`ApiClientError` 携带 `code`、`status`、`requestId`、
  `params` 与 `details`；通过 `zodIssueToken` 把字段级错误映射到 i18n。

### 运维脚本

- **40+ 个脚本**——`scaffold`、`bootstrap:admin`、`deployment:bootstrap`、
  `deployment:adopt`、`release:production`、`production-preflight`、
  `verify-deployment`、`migrate-attachments-to-r2`、`r2-dry-run`、
  `i18n-check`、`frontend-contract-check`、`schema:check`、
  `workflow-security`、`config-parity`、`release-notes`。
- **CI 门禁**——发布前必须通过 `format:check`、`lint`、`typecheck`、
  `schema:check`、`test`、`i18n:check`、`frontend-contract-check`、`build`、
  `deploy:dry-run` 以及端到端测试。

## 仓库结构

```text
apps/worker/          Worker 入口与各功能模块
apps/web/             React/Vite 应用
packages/contracts/   运行时 schema 与跨边界类型
packages/email-core/  Provider 中立的邮件组合规则
packages/config/      运行时安全与重试策略
packages/test-kit/    共享测试夹具
migrations/           经审核的 D1 SQL
scripts/              脚手架、迁移、发布与验证 CLI
.skills/runbooks/     运维恢复流程
```

## 技术栈

| 层级          | 选型                                                                                            |
| ------------- | ----------------------------------------------------------------------------------------------- |
| 运行时        | Cloudflare Worker（单一部署），`wrangler.jsonc` + `wrangler.r2.jsonc` overlay                   |
| 框架          | Worker 端 Hono 4；前端 React 18 + Vite 5                                                        |
| 数据          | D1 + Drizzle ORM；KV 用于速率限制、心跳、附件回退；R2（可选）用于大体量附件；Queue 用于出站投递 |
| 认证          | `sessionStorage` 中的 Bearer access token + HttpOnly refresh cookie；位掩码 RBAC                |
| 类型安全      | `@unimailbox/contracts` 中的 Zod 3 schemas，由 worker 与 web 共享                               |
| 前端数据      | TanStack Router + Query + Form                                                                  |
| 编辑器        | TipTap + DOMPurify；通过 Dexie 在 IndexedDB 中存储草稿                                          |
| i18n          | i18next；`en` / `zh-CN` 进入生产；`ar-XB` 伪本地化用于 RTL 测试                                 |
| 监控          | `@sentry/cloudflare` + `@sentry/react`                                                          |
| 测试          | Vitest（unit / integration / worker pool）以及 Playwright e2e                                   |
| Lint / format | ESLint 9、Prettier 3、TypeScript 5                                                              |

## 本地开发

环境要求：Node 22.22.1、pnpm 10.32.1、Wrangler 4.114.0。完整的贡献者文档
参见 [`docs/development.md`](docs/development.md)。

```bash
pnpm install
cp .dev.vars.example .dev.vars       # 然后填入两个 `replace-with-…` 占位符
pnpm scaffold init
INITIAL_ADMIN_EMAIL=admin@example.com \
  INITIAL_ADMIN_PASSWORD='replace-with-a-strong-password' \
  pnpm bootstrap:admin -- --target local
pnpm dev                              # Wrangler 运行于 127.0.0.1:8787
```

使用初始管理员凭据在 `/login` 登录。`pnpm dev:web` 仅启动 Vite SPA；它会把
`/api` 与 `/health` 代理到本地 Wrangler。`.dev.vars` 存放两个本地运行期密钥；
生产版本会自动生成这两个值。`INITIAL_ADMIN_EMAIL` 与 `INITIAL_ADMIN_PASSWORD`
是一次性输入：bootstrap 会把密码哈希写入 D1 之后就可以移除这两个值。Provider
和 Cloudflare 的设置在登录后配置，凭据经 AES-GCM 加密后存到 D1。不要提交
`.dev.vars` 或初始凭据。

## 校验

```bash
pnpm scaffold doctor
pnpm format:check
pnpm lint
pnpm typecheck
pnpm schema:check
pnpm test
pnpm test:coverage
pnpm i18n:check
pnpm frontend:contracts
pnpm test:e2e
pnpm build
pnpm deploy:dry-run
pnpm deploy:r2:dry-run
```

`pnpm db:migrate --target production` 在缺少 `--confirm <deployment-id>` 时
拒绝执行。任何 migration 与 release 命令执行前都会核验已发布的迁移校验和。

## 部署

根目录的 [`wrangler.jsonc`](wrangler.jsonc) 故意不写账户 ID 与资源 ID；首次
Deploy Button 构建时 Cloudflare 会创建声明的 D1、KV 与 Queue 资源。
`pnpm deploy` 是有意设计为首次安装路径；Cloudflare 写好生成的资源 ID 之后，
在受信任的 shell 中运行 `pnpm deployment:bootstrap`，即可应用 migration、建
立管理员账号并补齐运行期密钥。健康部署之后，运行
`pnpm deployment:adopt -- --confirm-admin-bypass-disabled` 来记录非密
钥的安装清单，并通过 GitHub `production` Environment 把生产环境托管起来。
R2 通过 [`wrangler.r2.jsonc`](wrangler.r2.jsonc) 显式启用，使冷启动部署不需
要付费计划。

完整的安装 / adopt / release 流程见
[`docs/deployment.md`](docs/deployment.md)；切换后端请参考
[`.skills/runbooks/attachment-storage-migration.md`](.skills/runbooks/attachment-storage-migration.md)；
投递类故障处理请参考
[`.skills/runbooks/mail-delivery-recovery.md`](.skills/runbooks/mail-delivery-recovery.md)。

> 生产发布刻意保留 operator-gated 的设计。入站路由、Queue、Cron 与 provider
> 的退出标准无法仅靠本地 mock 验证；只有对已部署实例跑通文档中的烟囱测试，
> 才能视为发布完成。

## 文档与 Runbook

- [本地开发指南](docs/development.md)
- [部署指南](docs/deployment.md)
- [发布与分发策略](docs/releases.md)
- [兼容性与维护策略](docs/compatibility.md)
- [源码蓝图](docs/rebuild-blueprint.md)
- [外部邮件导入调研（POP3 / IMAP，草案）](.skills/plans/external-mail-import-research.md)

Runbook：

- [Migration 失败恢复](.skills/runbooks/migration-recovery.md)
- [出站与 Webhook 恢复](.skills/runbooks/mail-delivery-recovery.md)
- [附件后端迁移](.skills/runbooks/attachment-storage-migration.md)
- [Bootstrap 与账户恢复](.skills/runbooks/setup-recovery.md)
- [本地管理员 Bootstrap](.skills/runbooks/local-admin-bootstrap.md)
- [可观测性与告警](.skills/runbooks/observability-alerts.md)

项目：

- [贡献指南](CONTRIBUTING.md)
- [安全策略](SECURITY.md)
- [更新日志](CHANGELOG.md)
- [许可证](LICENSE)

## 许可证

UniMailbox 采用 [GNU Affero General Public License v3.0 only](LICENSE)
（`AGPL-3.0-only`）许可证。如果你在网络上运行修改版本，请审阅许可证中关于
相应源代码义务的条款。
