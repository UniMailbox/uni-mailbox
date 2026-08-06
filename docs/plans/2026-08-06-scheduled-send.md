# Plan: 定时发送（Scheduled Send）

## Goal

为草稿增加一次性定时发送能力，复用既有的 Cron → D1 outbox → Queue 异步投递链路，不引入 Durable Object、Workflows 或第二套调度器；最小化改动面，最大化保留消息/草稿/外发/重试的现有可靠性保证。

## Scope

### In scope

- `POST /api/v1/drafts/:draftId/schedule` 创建或重排排程；`DELETE /api/v1/drafts/:draftId/schedule` 取消排程。
- 草稿 `DraftDetail` / `DraftSummary` 返回可空的 `scheduled_at` 与 `updatedAt`，但**不**修改 `messages.status`，**不**新增 SQLite CHECK 迁移。
- 接受带 offset 的 ISO-8601 instant；窗口：距离 now 至少 90 秒、最多 30 天；窗口外或格式不合法返回稳定错误。
- 草稿即时发送时如果存在未来/已入队定时 job，必须返回 `DRAFT_SCHEDULED`；用户需先取消排程再立即发送。
- 异步执行时复用现有 `OutboundJobService.processOutboundJob` 的 claim、锁、provider 幂等、业务退避和锁恢复；定时草稿在执行成功后迁移到 `mailbox_messages.folder='sent'`，纯内部收件人在执行时也建立 inbox relation。
- i18n、文档、运行 runbook 同步更新。

### Out of scope

- 周期性、模板批量、定时回复或自然语言时间。
- Durable Object / Workflows / 秒级准点；现有 1 分钟 Cron 边界明确在 UI 文案中说明。
- DLQ 自动消费、平台重试与业务重试合并；列入 `docs/investigations/2026-08-06-queue-investigation.md` 的后续项，不在本计划内。

## Final state of the implementation

### Contract (`packages/contracts/src/api/drafts.ts`)

- `DraftScheduleSchema = { scheduledAt }`；`scheduledAt` 必须是带 offset 的 ISO-8601 字符串。
- `DraftDetailSchema` / `DraftSummarySchema` 新增 `scheduled_at: z.string().nullable().optional()`。
- `draftEndpoints.schedule` 返回 `{ messageId, status: 'scheduled', scheduledAt, updatedAt }`；`draftEndpoints.cancelSchedule` 返回 `{ messageId, status: 'draft', cancelled, updatedAt }`。
- 错误码加入 `ERROR_CODES`：`SCHEDULE_WINDOW_EXCEEDED`、`SCHEDULE_ALREADY_DISPATCHED`、`DRAFT_SCHEDULED`。
- `IdempotencyKeySchema` 提取共用。

### Service (`apps/worker/src/modules/messages/`)

- `schedule.ts`：时间窗口/ISO/UTC 解析、幂等 hash、SQL 片段 `SCHEDULED_AT_SELECT`。
- `drafts.ts`：
  - `send()` 在草稿 `send` 前先检查 `outbound_jobs` 是否存在 `pending`/`enqueued`；若是则 `DRAFT_SCHEDULED`；`processing` 则 `SCHEDULE_ALREADY_DISPATCHED`。
  - `schedule()` 按 `operation='draft.schedule'` 维护幂等，事务内执行：更新 `messages.provider_connection_id` + `updated_at` 版本号 → `UPDATE outbound_jobs` 重排或 `INSERT … WHERE NOT EXISTS` 首次创建 → 写入幂等记录。
  - `cancelSchedule()` 按 `operation='draft.schedule.cancel'` 维护幂等，事务内：`DELETE outbound_jobs WHERE status IN ('pending','enqueued')` → `UPDATE messages … WHERE NOT EXISTS (outbound_jobs)` → 写入幂等记录。结果检查保证不会留下“版本已 bump 但行还在”的部分成功状态。
  - `get/list` 额外 LEFT JOIN 活动 pending 定时任务展示 `scheduled_at`。
- 复用 `assertDraftVersion` / `loadRecipients` / `mailboxes.assert('send')` 等已有边界，不复制授权。

### Outbound (`apps/worker/src/modules/outbound-mail/index.ts`)

- `loadProviderMessage` 改为 LEFT JOIN provider/credentials；当消息仅是内部收件人时返回无 provider 的 row；`hasExternal` 由 recipient 行决定，attachments 仅在有外部收件人时读取，缺失则抛 `OUTBOUND_MESSAGE_NOT_FOUND`。
- `processOutboundJob`：
  - 若无外部收件人则跳过 `plugin.outbound.send`。
  - 成功完成 batch 增加 `UPDATE mailbox_messages SET folder='sent' WHERE folder='drafts'` 与 `INSERT OR IGNORE mailbox_messages (... 'inbox')` for every internal mailbox。
  - 终态失败 batch 增加 `UPDATE mailbox_messages SET folder='sent' WHERE folder='drafts'`，让失败邮件在 Sent 列表中可观察。
  - 日志字段加 `scheduled: messages.status === 'draft'`，便于运营区分“定时执行” vs “即时执行”。

### HTTP (`apps/worker/src/http/router.ts`)

- 挂载 `POST/DELETE /api/v1/drafts/:id/schedule`；沿用 `requireAuth` 链；返回 envelope 设置 ETag（`result.updatedAt`）。
- `DraftScheduleSchema.parse` 校验 body；schedule 用 `Etag` 头透传 `if-match`；cancel 类似。

### Web (`apps/web/`)

- `features/mail/api.ts`：`draftScheduleMutationOptions` 与 `draftCancelScheduleMutationOptions`；缓存失效复用 `mailKeys.draft/drafts` 和 `invalidateMessageLists`。
- `features/mail/ComposePanel.tsx`：状态机 `scheduledAtInput`（datetime-local，默认 `now+2min`）；按钮组：保存 / 定时发送 / 取消定时 / 立即发送；定时发送按钮在 schedule mutation 期间禁用并展示进度；错误在面板内联展示。
- i18n：en/zh-CN/ar-XB 增加 `compose.scheduleAt`、`scheduleSend`、`scheduling`、`cancelSchedule` 等键；`errors.json` 三套 locale 新增 `SCHEDULE_WINDOW_EXCEEDED / SCHEDULE_ALREADY_DISPATCHED / DRAFT_SCHEDULED`。

## Steps

1. 落 contracts/time utilities + service 实现（含单测与合约测试）。
2. 完善 outbound 异步执行（不破坏即时发送）。
3. 挂路由并发送/取消互斥保护。
4. 实现前端 UI 与多语言。
5. 文档与 runbook 同步。

## Verification (final run)

- `pnpm --filter @unimailbox/contracts test` ✅ 8 files / 68 tests。
- `pnpm exec vitest run apps/worker/test/unit` ✅ 30 files / 163 tests。
- `pnpm exec vitest run apps/worker/test/worker` ✅ 15 tests。
- `pnpm exec vitest run --config vitest.integration.config.ts` ✅ 12 files / 63 tests。
- `pnpm exec tsc --noEmit -p apps/worker/tsconfig.json` ✅ clean。
- `pnpm --filter @unimailbox/web exec vitest run` ✅ 34 files / 192 tests。
- `pnpm i18n:check` ✅ parity passed。
- `pnpm exec tsc --noEmit -p apps/web/tsconfig.json` ✅ clean。

## Notes & follow-ups

- 现有 DLQ 消费者、平台与业务重试合并仍是后续项，见 `docs/investigations/2026-08-06-queue-investigation.md`。
- 文案明确告诉用户"按分钟级 cron 投递，可能延迟约一分钟"；UI 不会承诺秒级准点。
