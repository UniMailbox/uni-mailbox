# 本地注入管理员并测试

这份文档配套 [`README.md`](../../README.md) 和
[`setup-recovery.md`](setup-recovery.md) 使用。它只回答一个具体问题：

> 在本机从零起步，怎么把第一个管理员写进 D1，登录进去，然后验证他/她的权限
> 确实是 administrator？

文档覆盖：

1. 注入机制的关键事实（什么决定谁是 admin）。
2. 一次性本机引导的完整命令序列。
3. 登录并触发一次受保护操作来做"端到端冒烟"。
4. 怎么把这一段流程纳入自动化测试（单元 + 集成 + 离线 D1）。
5. 失败模式速查。

如果你只想跑通一遍，跳到 [第 2 节](#2-本机一次性引导) 即可；第 1、3、4 节是
为改动相关代码或写新测试的人准备的。

---

## 1. 机制关键事实

### 1.1 没有 email 白名单

管理员的判定**不**基于 `INITIAL_ADMIN_EMAIL` 这个值本身。它走的是 D1 里
`user_roles` 这张表：

```text
users ──< user_roles >── roles ──< role_permissions >── permissions
```

角色 ID 是**硬编码 UUID**：

| 角色            | UUID                                   |
| --------------- | -------------------------------------- |
| `administrator` | `00000000-0000-4000-8000-000000000001` |
| `member`        | `00000000-0000-4000-8000-000000000002` |

`0002_seed_permissions.sql` 把 19 个 `PERMISSION_KEYS` 全部灌给了
`administrator` 角色，`member` 只拿到 6 个 `message.*` / `mailbox.*`。
登录时 `IdentityApplicationService.permissionsForUser`（`apps/worker/src/modules/identity/application.ts:484-497`）会
把这些 permission 内嵌到 access token 里。

任何 admin 路由入口都先 `assertPermission(principal, "user.manage" | ...)`，
不通过抛 `PERMISSION_DENIED` 403。**没有其他 admin 入口**。

### 1.2 两条相关代码路径

- **生产路径**：`scripts/release.mjs` 在 `bootstrap-administrator` 步骤里调用
  `scripts/bootstrap-admin.mjs --target production`（`scripts/release.mjs:410-411`）。
- **本机路径**：同一个 `bootstrap-admin.mjs --target local`，是 `pnpm bootstrap:admin` 的实现。

`IdentityApplicationService.createFirstAdministrator()`（`apps/worker/src/modules/identity/application.ts:75-104`）
保留了一份直接通过 D1 写 admin 的旧逻辑，但 router 没暴露任何调用点，目前是
**死代码**。所有现实中的 admin 注入都走 `bootstrap:admin` CLI。

### 1.3 `INITIAL_ADMIN_EMAIL` / `INITIAL_ADMIN_PASSWORD` 是什么

它们是 **bootstrap CLI 的命令行环境变量**，不是 Worker 运行时 secret。

- **不要**写进 `.dev.vars`（`.dev.vars.example:5-6` 明确警告）。
- **不要**写进 git。
- 校验规则（`scripts/bootstrap-lib.mjs:33-45`）：
  - `INITIAL_ADMIN_EMAIL`：合法 email 格式，≤254 字符，会被 `trim+lowercase`。
  - `INITIAL_ADMIN_PASSWORD`：**12–1024 字符**。
- 一旦 admin 写进 D1，密码会以 PBKDF2-SHA256 / 310,000 次迭代 / 16 字节随机盐
  哈希存储（`scripts/bootstrap-lib.mjs:47-62`）。原值可以立刻丢弃。

### 1.4 bootstrap 脚本做了什么

`scripts/bootstrap-admin.mjs`（150 行）做的事：

1. 用 D1 查 `users JOIN user_roles WHERE role_id = '...0001'` 的数量。
2. **如果已经有 admin**：把 `installation_state` 标成 `complete` 然后退出（幂等）。
3. **如果没有 admin**：
   1. `validateInitialAdministrator(process.env)` 校验 email/password。
   2. `createPasswordRecord(password)` 生成 PBKDF2 记录。
   3. `createAdministratorBootstrapSql({...})` 生成三段 SQL：
      - `INSERT INTO users ... WHERE NOT EXISTS (...已经存在 administrator...)`
      - `INSERT INTO user_roles (...) WHERE NOT EXISTS (...0001 角色...)`
      - `UPDATE installation_state SET current_step = 'complete' ...`
   4. 写到 `.wrangler/release/.administrator-bootstrap-<uuid>.sql`，mode `0600`。
   5. `pnpm exec wrangler d1 execute DB --local --file <tmp> --json` 执行。
   6. **`finally` 块 `unlink` 临时文件**。
   7. 验证后置：恰好 1 个 admin + `installation_state.current_step = 'complete'`。

整个流程 **不会** 把 email、password、hash、salt 或任何 runtime secret 打印到
stdout。失败时打印的是结构化事件名（`bootstrap.initial_credentials_invalid` 等）。

### 1.5 Bootstrap gate

`apps/worker/src/http/router.ts:62-66, 132-144` 装了一道 gate：

```text
/health          → 放行
/setup, /api/v1/setup/*  → 放行（远程安装期 carved-out）
其他任何路径       → 先调 installation.getStatus()，
                     若 currentStep !== 'complete' 就 503 BOOTSTRAP_INCOMPLETE
```

所以在 admin 注入之前访问 `/login` 也会被挡。`pnpm bootstrap:admin` 之后
才能进。

---

## 2. 本机一次性引导

### 2.1 前置

- Node 22、pnpm 10.32.1、Wrangler 4.114.0（`scripts/scaffold.mjs:29-42` 的
  `doctor` 会硬检查这些）。
- Cloudflare 账号仅在你想跑 live Email Routing / Brevo 验证时才需要；本机
  D1 是 miniflare 的本地 SQLite，不需要任何远端凭据。

### 2.2 命令序列

```bash
# 0) 克隆 + 安装
git clone <repo> cf-startup && cd cf-startup
pnpm install

# 1) 生成 runtime secret。两条 key 都需要 ≥32 字节随机串
cp .dev.vars.example .dev.vars
# 编辑 .dev.vars，把两个 replace-with-at-least-32-random-characters
# 换成两条独立的随机字符串。openssl rand -base64 48 可以用。

# 2) 初始化本地 D1：创建 .wrangler/state/、跑 migrations、verify
pnpm scaffold init
# 内部：node scripts/scaffold.mjs init
#   -> mkdir .wrangler/state
#   -> doctor() 校验 node/pnpm/wrangler 版本 + 根 binding
#   -> node scripts/migration.mjs migrate --target local
#   -> node scripts/migration.mjs verify --target local
# 期望日志末尾出现 scaffold.init.completed

# 3) 注入初始 admin
INITIAL_ADMIN_EMAIL=admin@example.com \
  INITIAL_ADMIN_PASSWORD='replace-with-a-strong-password' \
  pnpm bootstrap:admin -- --target local
# 期望日志末尾出现 bootstrap.administrator.completed
# 注意 '--'：先经过 pnpm 转发，再传给 node scripts/bootstrap-admin.mjs

# 4) 可选：生产模式 build
pnpm build

# 5) 启动本地 Worker（wrangler dev，监听 8787）
pnpm dev
# 期望日志出现 "Ready on http://127.0.0.1:8787"
```

> `pnpm dev:web`（Vite 5173，代理 `/api` `/health` 到 8787）只在改前端时
> 用；跑 admin 流程请用 `pnpm dev`。

### 2.3 验证注入

```bash
# 至少有 1 行（一个 admin），否则命令会非 0 退出
pnpm exec wrangler d1 execute DB --local --json \
  --command "SELECT COUNT(*) AS n FROM users u \
             JOIN user_roles ur ON ur.user_id = u.id \
             WHERE ur.role_id = '00000000-0000-4000-8000-000000000001'"

# 状态应该是 'complete'
pnpm exec wrangler d1 execute DB --local --json \
  --command "SELECT current_step FROM installation_state WHERE id = 1"
```

期望 `administrator_count = 1`、`current_step = 'complete'`。

### 2.4 幂等性

- 再次跑 `pnpm bootstrap:admin -- --target local`：**不会**创建第二个 admin，
  也不会覆盖现有密码。它会走 `existing` 分支，把 `installation_state` 刷成
  `complete` 然后退出。
- 想用新邮箱/新密码**重新**做一次，必须先手动 `DELETE FROM user_roles` /
  `DELETE FROM users` 那个旧 admin（否则 `WHERE NOT EXISTS` 会跳过插入）。

---

## 3. 登录并做一次受保护操作的冒烟

### 3.1 通过 UI

1. 浏览器打开 Wrangler 打印的 URL（默认 `http://127.0.0.1:8787`）。
2. 应该被重定向到 `/login`（如果被路由到 `/setup`，说明 `installation_state`
   还没 `'complete'`，回到 §2.3 检查 D1）。
3. 用注入时的 `INITIAL_ADMIN_EMAIL` / `INITIAL_ADMIN_PASSWORD` 登录。
4. 登录后应该看到 admin 控制平面入口（用户/角色/域名/分析），没有 403。
5. 打开 DevTools → Application → Cookies，应该看到一条
   `unimailbox_refresh` cookie，属性 `HttpOnly; SameSite=Strict; Path=/api/v1/auth`。

### 3.2 通过 API（更适合脚本化）

`IdentityApplicationService.login`（`apps/worker/src/http/router.ts:176-193`）会
返回 access token（JSON body）+ refresh cookie：

```bash
# 登录
curl -i -X POST http://127.0.0.1:8787/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@example.com","password":"replace-with-a-strong-password"}' \
  -c /tmp/cookies.txt
# 期望：200，body 含 accessToken，Set-Cookie: unimailbox_refresh=...

# 用 access token 调一个 admin 路由
curl -i http://127.0.0.1:8787/api/v1/admin/users \
  -H "authorization: Bearer <accessToken>"
# 期望：200，body 是 users 列表

# 拿 refresh cookie 续 access token
curl -i -X POST http://127.0.0.1:8787/api/v1/auth/refresh -b /tmp/cookies.txt
# 期望：200 + 新的 accessToken + 旋转过的 refresh cookie
```

如果 `/api/v1/admin/users` 返回 `PERMISSION_DENIED`（403），说明
`Principal.permissions` 没拿到 `user.manage`，通常是以下其中之一：

- 注入时 `user_roles` 行没写成功（回到 §2.3）。
- `0002_seed_permissions.sql` 没跑成功（`pnpm db:verify --target local` 查）。
- access token 来自更老的会话（重新登录一次）。

### 3.3 一次写操作的幂等

`/api/v1/admin/*` 下任何 `POST/PUT/PATCH/DELETE` 都要带 `Idempotency-Key`
header（`apps/worker/src/http/admin-idempotency.ts`，挂在 `router.ts:609`）：

```bash
curl -i -X POST http://127.0.0.1:8787/api/v1/admin/users \
  -H "authorization: Bearer <accessToken>" \
  -H 'idempotency-key: smoke-test-1' \
  -H 'content-type: application/json' \
  -d '{"email":"alice@example.com","password":"another-strong-password","displayName":"Alice","roleIds":[]}'

# 立刻重放同 key + 同 body：应返回 200/201 + x-idempotent-replay: 1
curl -i -X POST http://127.0.0.1:8787/api/v1/admin/users \
  -H "authorization: Bearer <accessToken>" \
  -H 'idempotency-key: smoke-test-1' \
  -H 'content-type: application/json' \
  -d '{"email":"alice@example.com","password":"another-strong-password","displayName":"Alice","roleIds":[]}'

# 同一个 key + 不同 body：应返回 409 IDEMPOTENCY_KEY_REUSED
curl -i -X POST http://127.0.0.1:8787/api/v1/admin/users \
  -H "authorization: Bearer <accessToken>" \
  -H 'idempotency-key: smoke-test-1' \
  -H 'content-type: application/json' \
  -d '{"email":"bob@example.com","password":"another-strong-password","displayName":"Bob","roleIds":[]}'
```

缺 header 会 428 IDEMPOTENCY_KEY_REQUIRED。这个中间件和"我是 admin"是两件事，
但它只在 admin 路径上挂，所以是 admin 流程最常踩的契约。

---

## 4. 把这一段纳入自动化测试

bootstrap 流程有三层覆盖。

### 4.1 纯单元：`scripts/bootstrap.test.mjs`

不连 D1，覆盖纯函数：

```bash
pnpm test:unit -- bootstrap
# 等价于：vitest run apps/worker/test/unit scripts/*.test.mjs 中的 bootstrap
```

测了：

- `reconcileRuntimeSecretNames` 只生成缺失的 secret，不会覆盖已有值。
- `validateInitialAdministrator` 接受合法值、拒绝过短密码、拒绝坏 email、**不会回显明文**。
- `createPasswordRecord` 的输出能被 `PasswordService.verify` 验证通过。
- `sqlLiteral` 正确转义 `'`（防 SQL 注入）。
- `createAdministratorBootstrapSql` 的批处理**不含**明文 email/password（防
  日志泄漏），且 `WHERE NOT EXISTS` 守卫使它幂等。

### 4.2 Worker 集成：`apps/worker/test/integration/admin.test.ts`

基于 `@cloudflare/vitest-pool-workers`，跑在**真实 D1** 上（miniflare），用
`applyD1Migrations` 拉全部 migrations：

```bash
pnpm test:integration -- admin
# 等价于：vitest run --config vitest.integration.config.ts -t admin
```

测的是 `AdminApplicationService` 的契约：列出用户/角色、新建/更新/删除用户、
self-delete 阻止、system role 不可改、签名校验、域名/设置/分析等。**不依赖**
`bootstrap:admin` CLI，是单元级 service 测试。

### 4.3 E2E：`e2e/setup.spec.ts`

```bash
pnpm test:e2e:install      # 一次性安装 chromium
pnpm test:e2e
```

当前覆盖的是"未 bootstrap 时访问根路径被重定向到 `/setup`"。

### 4.4 写新测试时的位置

- 改 bootstrap SQL/CLI 行为 → `scripts/bootstrap.test.mjs`。
- 改 admin service 业务规则 → `apps/worker/test/integration/admin.test.ts`
  （已有 `seedAdministrator` helper，照着加 case 即可）。
- 改 router / 中间件契约（idempotency、auth） →
  `apps/worker/test/integration/` 下加 HTTP 层测试。
- 改前端登录页 → `apps/web/src/features/auth/__tests__/`（vitest + Testing
  Library）。
- 改端到端路径 → `e2e/`。

---

## 5. 失败模式速查

| 现象                                                      | 看哪里                                                                                            | 修复                                                                                                                                |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `bootstrap.initial_credentials_invalid`                   | `scripts/bootstrap-lib.mjs:33-45`                                                                  | 邮箱格式、密码 12–1024 字符。错误**不**会打印密码本身。                                                                              |
| `bootstrap.d1_command_failed` / `bootstrap.d1_output_invalid` | `scripts/bootstrap-admin.mjs:40-64`                                                                | `pnpm db:verify --target local` 先确认 schema 正常；再 `pnpm db:migrate --target local` 修 migrations。                              |
| `bootstrap.postcondition_failed`                          | 后置条件：恰好 1 admin + `current_step = 'complete'`                                               | **停手**。检查 D1 `users` / `user_roles` / `installation_state` 三表的实际内容；先 `SELECT` 看清再决定删除什么。                    |
| 浏览器一直跳到 `/setup`                                   | `installation_state.current_step` 不是 `'complete'`                                                | `pnpm db:verify --target local`；再 `pnpm bootstrap:admin -- --target local`（existing 分支会刷新 state）。                          |
| `/login` 后立刻被踢出 / 401                               | access token 来自旧 session                                                                        | 重新登录一次；如果一直失败，删浏览器 cookie 再试。                                                                                    |
| `/api/v1/admin/*` 返回 403                                | `Principal.permissions` 缺 `user.manage`                                                          | §3.2 末尾的三个排查项。                                                                                                              |
| `/api/v1/admin/*` POST/PUT 返回 428                       | 缺 `Idempotency-Key`                                                                              | 加 `Idempotency-Key: <opaque token ≤255 chars>`。                                                                                    |
| 同一个 idempotency key 第二次返回 409                     | payload 指纹不同                                                                                  | 换 key，或用同 body 重放（应返回 200 + `x-idempotent-replay: 1`）。                                                                  |
| `pnpm bootstrap:admin` 报 admin 已存在                    | **预期**——`existing` 分支是幂等保护                                                                | 如果想重置：手动 `DELETE FROM user_roles WHERE role_id='00000000-0000-4000-8000-000000000001'` 再 `DELETE FROM users WHERE ...`。     |
| 改完 schema 之后 admin 没了                               | migrations 触发了 `users` / `user_roles` 上的 destructive change                                    | 从 D1 Time Travel 恢复；新 migration 必须是 expand-and-contract 模式（`pnpm db:migration:new` 的模板默认如此）。                     |
| CI 上跑 `pnpm bootstrap:admin` 报权限错                   | CI runner 用了同一个 D1                                                                           | CI 不应跑 bootstrap。`bootstrap:admin` 是 dev / 本机 / release 阶段的命令；CI 走 `pnpm db:migrate` + `pnpm test:integration` 即可。 |

---

## 6. 跟其他文档的关系

- [`README.md`](../../README.md) §"Local development"——是入口的 5 行精简版。
  本文档是它的展开。
- [`docs/runbooks/setup-recovery.md`](setup-recovery.md)——**生产/远端**故障
  恢复（看的是 `release.*` / `bootstrap.*` 事件名）。本文档是**本机**流程。
- [`docs/runbooks/migration-recovery.md`](migration-recovery.md)——D1 schema
  出了问题时的回滚 / Time Travel 路径，跟"admin 注入失败"是相邻但不同的失败
  域。
- [`docs/deployment.md`](../deployment.md)——`pnpm release:production` 怎么
  间接调用 `bootstrap:admin`。
- [`docs/rebuild-blueprint.md`](../rebuild-blueprint.md)——完整代码蓝图，包含
  `IDENTITY_APPLICATION_SERVICE`、`ADMIN_APPLICATION_SERVICE` 的全部方法签名。
