# Frontend Platform Acceptance Standard

Date: 2026-07-31

Design:
`docs/superpowers/specs/2026-07-31-frontend-platform-modernization-design.md`

Implementation plan:
`docs/superpowers/plans/2026-07-31-frontend-platform-modernization.md`

Rules:
`docs/rules/frontend-platform.md`

## Status Vocabulary

- `Pending`: not yet executed or evidence is incomplete.
- `Passed`: current evidence directly proves the requirement.
- `Failed`: current evidence contradicts the requirement.
- `Blocked`: the check was attempted but an external/environment condition
  prevented completion.

Do not convert `Blocked` or a narrower passing check into `Passed`.

## Completion Summary

| Gate | Status | Required evidence |
| --- | --- | --- |
| English UI complete | Passed | Fresh English Playwright project: 20/20. |
| Simplified Chinese UI complete | Passed | Fresh Chinese Playwright project: 20/20. |
| Language preference | Passed | Context initialization, reload, and actual logout/login E2E evidence. |
| Error localization | Passed | Known/unknown/request-ID unit and fresh browser evidence. |
| TanStack Router | Passed | Route tests, legacy routing scan, and fresh browser guards. |
| TanStack Query service model | Passed | Feature API tests and enforcement passed. |
| Endpoint contracts | Passed | Contract/client tests and enforcement passed. |
| TanStack Form | Passed | Form tests and source/dependency enforcement passed. |
| RTL foundations | Passed | Fresh desktop/mobile pseudo-RTL E2E: 6/6. |
| Compose preservation | Passed | Focused unit and fresh browser regression suite. |
| Accessibility | Passed | Role/name assertions plus executable EN/zh/RTL keyboard E2E and visual evidence. |
| Full repository gates | Passed | Exact command log, including a fresh 46/46 browser matrix. |
| User-change preservation | Passed | Clean implementation-worktree baseline and final scope audit recorded. |

## 1. Locale Runtime

### Automated requirements

- [x] Valid persisted `en` overrides a Chinese browser locale.
- [x] Valid persisted `zh-CN` overrides an English browser locale.
- [x] Every `zh`, `zh-CN`, `zh-SG`, `zh-Hans`, and `zh-Hant` browser locale
      normalizes to `zh-CN`.
- [x] Unsupported persisted locale falls back to browser detection.
- [x] Persisted `ar-XB` is rejected in production resolution.
- [x] Missing/unsupported browser locale falls back to `en`.
- [x] i18n initialization completes before React render.
- [x] Language change updates `html.lang`.
- [x] Language change updates `html.dir` from centralized metadata.
- [x] Language change updates document title and description.
- [x] Language change persists production locale.
- [x] Test-only RTL locale does not persist as a production preference.

Evidence:

```bash
pnpm --filter @unimailbox/web exec vitest run src/i18n/locale.test.ts src/i18n/index.test.ts
```

Status: `Passed` — 2026-08-01 focused locale/index suite: 6 tests passed.

## 2. Resource Integrity

- [x] English and Chinese have identical namespace sets.
- [x] English and Chinese have identical leaf-key sets.
- [x] English and Chinese interpolation variables match for every key.
- [x] English and Chinese plural suffix sets match.
- [x] No production translation value is empty.
- [x] Every stable ErrorCode has English and Chinese text.
- [x] Dynamic keys are backed by explicit typed maps.
- [x] Production resources do not include `ar-XB` in the selectable locale
      list.

Evidence:

```bash
pnpm i18n:check
pnpm --filter @unimailbox/web exec vitest run src/i18n/resources.test.ts
```

Status: `Passed` — 2026-08-01 `pnpm i18n:check` and resource suite: 2 tests passed.

## 3. English and Chinese Functional Matrix

Both production locales must complete:

| Workflow | en | zh-CN |
| --- | --- | --- |
| Login screen and validation | Passed — `e2e/login.spec.ts` | Passed — `e2e/login.spec.ts` |
| Safe post-login deep link | Passed — `e2e/login.spec.ts` | Passed — `e2e/login.spec.ts` |
| Inbox list and pagination | Passed — `e2e/inbox.spec.ts` | Passed — `e2e/inbox.spec.ts` |
| Folder navigation | Passed — `e2e/inbox.spec.ts` | Passed — `e2e/inbox.spec.ts` |
| Star and move message | Passed — `e2e/inbox.spec.ts`, `e2e/message-mutations.spec.ts` | Passed — `e2e/inbox.spec.ts`, `e2e/message-mutations.spec.ts` |
| Message detail and attachments | Passed — `e2e/message-mutations.spec.ts`, `e2e/setup.spec.ts` | Passed — `e2e/message-mutations.spec.ts`, `e2e/setup.spec.ts` |
| New Compose and send | Passed — `e2e/setup.spec.ts` | Passed — `e2e/setup.spec.ts` |
| Draft restore, save, and send | Passed — `e2e/setup.spec.ts` | Passed — `e2e/setup.spec.ts` |
| Reply composition | Passed — `e2e/setup.spec.ts` | Passed — `e2e/setup.spec.ts` |
| Language preference switch | Passed — `e2e/preferences.spec.ts` | Passed — `e2e/preferences.spec.ts` |
| Preference after reload | Passed — `e2e/preferences.spec.ts` | Passed — `e2e/preferences.spec.ts` |
| Preference across logout/login | Passed — `e2e/acceptance-gaps.spec.ts` | Passed — `e2e/acceptance-gaps.spec.ts` |
| Account settings | Passed — `e2e/acceptance-gaps.spec.ts` | Passed — `e2e/acceptance-gaps.spec.ts` |
| Mailbox/member settings | Passed — `e2e/setup.spec.ts` | Passed — `e2e/setup.spec.ts` |
| Cloudflare settings | Passed — `e2e/setup-extras.spec.ts` | Passed — `e2e/setup-extras.spec.ts` |
| Storage settings | Passed — `e2e/setup-extras.spec.ts` | Passed — `e2e/setup-extras.spec.ts` |
| Administration authorized route | Passed — `e2e/preferences.spec.ts` | Passed — `e2e/preferences.spec.ts` |
| Administration forbidden route | Passed — `e2e/acceptance-gaps.spec.ts` | Passed — `e2e/acceptance-gaps.spec.ts` |
| Localized not-found boundary | Passed — `e2e/acceptance-gaps.spec.ts` | Passed — `e2e/acceptance-gaps.spec.ts` |
| Localized request error and request ID | Passed — `e2e/rtl.spec.ts` | Passed — `e2e/rtl.spec.ts` |

Evidence:

```bash
pnpm exec playwright test --project=en
pnpm exec playwright test --project=zh-CN
```

Each critical workflow includes at least one literal assertion in the target
language so translation-resource drift cannot make both UI and test pass.

Status: `Passed` — 2026-08-01 fresh isolated-server Playwright matrix: 20/20
`en`, 20/20 `zh-CN`, 3/3 `rtl-desktop`, and 3/3 `rtl-mobile` workflows passed
(46/46 total). Each matrix row above has direct E2E coverage.

## 4. Router and Guard Semantics

- [x] Custom history navigation is removed.
- [x] Production code has no application `popstate` listener.
- [x] Routes, params, search, and links use TanStack Router.
- [x] Unknown paths render localized 404.
- [x] `/setup` redirects to `/login`.
- [x] Current `/register` behavior remains explicit.
- [x] 401 redirects to login with replace semantics.
- [x] 401 stores only a validated safe destination.
- [x] `https://`, `//`, `/\\`, login, and register destinations are rejected.
- [x] 401 parent guard prevents protected child requests.
- [x] 403 renders forbidden and remains signed in.
- [x] 503 and 5xx render error boundaries rather than login.
- [x] Admin resource permissions match the shared permission contract.
- [x] Back, forward, replace, and deep links behave correctly in a browser.

Evidence:

```bash
pnpm --filter @unimailbox/web exec vitest run src/app/router.test.tsx
pnpm exec playwright test e2e/login.spec.ts
rg -n "pushState|replaceState|popstate|window\\.location\\.pathname" apps/web/src -g '*.ts' -g '*.tsx'
```

Expected source scan: no production custom-router implementation.

Status: `Passed` — router suite passed (24 tests), the production scan is
clean, and fresh browser guard E2E passed in both production locales.

## 5. Query Ownership and Cache Correctness

- [x] Every remote read uses feature-owned Query options.
- [x] Every query key comes from a feature-owned factory.
- [x] Equivalent normalized search produces one key.
- [x] Session Query options are reused by Router guard and components.
- [x] Message star invalidates/updates detail and list data.
- [x] Message move invalidates source, destination, and detail.
- [x] New send invalidates sent/message lists.
- [x] Draft send invalidates both message and draft data.
- [x] Attachment completion invalidates attachment data.
- [x] Mailbox/member mutations invalidate canonical mailbox/member data.
- [x] Cloudflare/provider mutations invalidate status and related admin data.
- [x] Admin mutations invalidate the correct resource.
- [x] No page component constructs an API URL or response interface.
- [x] Zustand contains no remote server records.

Evidence:

```bash
pnpm --filter @unimailbox/web exec vitest run src/features/auth/api.test.ts src/features/mail/api.test.ts src/features/settings/api.test.ts src/features/admin/api.test.ts
rg -n "queryKey:\\s*\\[" apps/web/src/features -g '*.tsx'
rg -n "apiRequest|apiResponse" apps/web/src/features -g '*.ts' -g '*.tsx'
```

Expected scans: no matches in production feature components.

Status: `Passed` — 2026-08-01 feature API suite: 20 tests passed; production scans and `pnpm frontend:contracts` passed.

## 6. Endpoint Contracts and Client

- [x] Every frontend-used endpoint declares method and path.
- [x] Params, query, headers, and body are declared when applicable.
- [x] Every accepted success status has a runtime schema.
- [x] Every operation declares its media type.
- [x] 204, binary, and redirect operations are explicit.
- [x] ETag and idempotency headers are explicit.
- [x] Caller input and parsed output types are distinct.
- [x] Successful responses are runtime validated.
- [x] Malformed success produces `CLIENT_RESPONSE_INVALID`.
- [x] Legacy `{ data }`, `{ error }`, and `details` remain compatible.
- [x] Request ID is retained from body or header.
- [x] Refresh retries exactly once.
- [x] Login never attempts refresh.
- [x] Unknown server code becomes `UNKNOWN_SERVER_ERROR` and retains raw code.
- [x] No final `apiRequest<T>` or raw normal-endpoint response escape hatch
      remains.

Evidence:

```bash
pnpm --filter @unimailbox/contracts test
pnpm --filter @unimailbox/web exec vitest run src/lib/api
pnpm frontend:contracts
```

Status: `Passed` — 2026-08-01 contracts: 56 tests passed; typed client/transport and enforcement passed. Deprecated generic request helpers were removed.

## 7. Error Safety and Localization

- [x] Known errors render code-based English text.
- [x] Known errors render code-based Chinese text.
- [x] Unknown errors render localized generic text.
- [x] Raw server message is not visible.
- [x] Raw storage reason is not visible.
- [x] Raw provider failure text is not visible.
- [x] Raw status enums are mapped to translations.
- [x] Request ID is visible and copyable when supplied.
- [x] Request ID is LTR-isolated in RTL content.
- [x] Non-JSON failure is safe and localized.
- [x] Internal exception text, stack, SQL, token, secret, and credential are
      absent from rendered output.

Evidence:

```bash
pnpm --filter @unimailbox/web exec vitest run src/i18n/errors.test.ts src/components/Status.test.tsx
rg -n "error\\.message|attachments\\.reason|diagnosticMessage" apps/web/src -g '*.tsx'
```

Expected scan: no visible production render of these values.

Status: `Passed` — unit suite passed (11 tests), and the fresh browser matrix
verified localized request-ID rendering in both RTL projects.

## 8. TanStack Form and Validation

- [x] Every form uses the application TanStack Form composition.
- [x] Every form uses shared/contract-backed Zod validation.
- [x] No page-local duplicate request schema remains.
- [x] Validation text is localized from stable issue information.
- [x] Submit state prevents duplicate submission.
- [x] Server errors remain separate from field errors.
- [x] Successful operations reset only the intended values.
- [x] Async hydration does not overwrite newer user input.
- [x] Dynamic admin forms use discriminated schemas.
- [x] `react-hook-form` is absent from production dependencies and source.

Evidence:

```bash
pnpm --filter @unimailbox/web exec vitest run src/lib/form src/features/auth src/features/settings src/features/admin
rg -n "react-hook-form|useForm<|useForm\\(" apps/web/src -g '*.ts' -g '*.tsx'
```

Expected scan: TanStack form imports/usages only; no React Hook Form.

Status: `Passed` — 2026-08-01 shared form/feature suite and production source/dependency enforcement passed; React Hook Form was removed.

## 9. Compose Preservation

- [x] Server draft hydrates recipients, subject, body, attachments, and
      version.
- [x] Reply hydrates recipient, subject prefix, quoted content, and parent ID.
- [x] Offline draft restores only without server draft or reply.
- [x] Autosave remains debounced at 400 ms.
- [x] Attachment upload preserves all other values.
- [x] Existing draft saves before send with current `if-match`.
- [x] Successful send removes offline working draft.
- [x] Successful draft send invalidates messages and drafts.
- [x] Language switch preserves recipients, subject, body, attachments, reply,
      server draft ID, and version.
- [x] Direction change does not recreate Tiptap or lose selection-compatible
      editor state.
- [x] Translated placeholder updates.

Evidence:

```bash
pnpm --filter @unimailbox/web exec vitest run src/features/mail/ComposePanel.test.tsx
pnpm exec playwright test --project=en e2e/inbox.spec.ts
pnpm exec playwright test --project=zh-CN e2e/inbox.spec.ts
```

Status: `Passed` — focused Compose suite passed (16 tests, including current
`if-match`); the fresh browser Compose save/send workflow passed in both
production locales.

## 10. RTL and Bidirectional Layout

Both `rtl-desktop` and `rtl-mobile` must prove:

- [x] `html.dir` is `rtl`.
- [x] `scrollWidth <= clientWidth`.
- [x] Sidebar appears at inline-start.
- [x] Composer appears at inline-end.
- [x] Back, next, and reply icons mirror.
- [x] Star, cloud, lock, spinner, and formatting icons do not mirror.
- [x] Emails remain readable and LTR-isolated.
- [x] UUIDs/request IDs/codes/paths remain readable and LTR-isolated.
- [x] Names and subjects use automatic bidi isolation.
- [x] Error cards do not overflow.
- [x] Chinese-expanded and pseudo-RTL copy do not clip controls.
- [x] Mobile off-canvas transforms and shadows follow inline direction.
- [x] Email iframe direction policy is explicit.

Evidence:

```bash
pnpm exec playwright test --project=rtl-desktop
pnpm exec playwright test --project=rtl-mobile
rg -n "margin-(left|right)|padding-(left|right)|border-(left|right)|text-align:\\s*(left|right)|float:\\s*(left|right)" apps/web/src/styles.css
```

Expected source scan: no unexplained application-layout match.

Status: `Passed` — logical-CSS scan passed; fresh desktop/mobile pseudo-RTL
browser matrix passed 4/4, including directional controls and LTR identifiers.

## 11. Accessibility

- [x] Every form input has a localized accessible label.
- [x] Icon-only actions have localized names.
- [x] Loading uses `role="status"` with `aria-live="polite"` and success uses
      `role="status"`.
- [x] Error state uses `role="alert"`.
- [x] Directional icons are decorative when their control is named.
- [x] E2E primarily uses role and accessible-name selectors.
- [x] Locale switching does not reduce keyboard access.
- [x] Visible focus remains on both LTR and RTL layouts.

Evidence:

- Testing Library role/name assertions.
- Playwright keyboard smoke checks in production locales and RTL mobile.
- Manual focus-order check recorded below.

Status: `Passed` — role/name assertions passed; new `e2e/login.spec.ts`
keyboard assertions cover EN and zh-CN, while `e2e/rtl.spec.ts` covers both
RTL viewports and verifies the email field remains LTR. Each starts from
`body`, presses `Tab` through wordmark, email, password, and submit, and
asserts active plus `:focus-visible` state. [EN](../evidence/frontend-platform/2026-08-01/en-login-focus-order.png)
and [RTL](../evidence/frontend-platform/2026-08-01/rtl-login-focus-order.png)
screenshots independently show the same visible sequence.

## 12. Static Legacy-Pattern Gates

All commands must return no prohibited production matches:

```bash
rg -n "react-hook-form|apiRequest<|apiResponse\\(|from [\"'].*navigation[\"']" apps/web/src
rg -n "error\\.message|attachments\\.reason|Intl\\.(DateTimeFormat|NumberFormat)\\(undefined" apps/web/src
pnpm i18n:check
pnpm frontend:contracts
```

Allowed technical matches must be narrowly documented by the enforcement
script and may not contain visible product copy or an uncontracted endpoint.

Status: `Passed` — 2026-08-01 `i18n:check` and `frontend:contracts` passed. Raw broad `rg` output is limited to tests and approved technical/brand/domain literals; enforcement rejects production violations.

## 13. Manual Visual Checks

Record evidence for:

| Check | Viewport | Locale | Status | Evidence |
| --- | --- | --- | --- | --- |
| Login long copy and validation | Desktop | zh-CN | Passed | [zh-login-desktop.png](../evidence/frontend-platform/2026-08-01/zh-login-desktop.png) |
| Inbox dense list | Desktop | zh-CN | Passed | [zh-inbox-dense-desktop.png](../evidence/frontend-platform/2026-08-01/zh-inbox-dense-desktop.png) |
| Compose recipients/editor/actions | Desktop | zh-CN | Passed | [zh-compose-desktop.png](../evidence/frontend-platform/2026-08-01/zh-compose-desktop.png) |
| Settings tabs and preference | Mobile | zh-CN | Passed | [zh-settings-preference-mobile.png](../evidence/frontend-platform/2026-08-01/zh-settings-preference-mobile.png) |
| Admin navigation/table/forms | Desktop | zh-CN | Passed | [zh-admin-desktop.png](../evidence/frontend-platform/2026-08-01/zh-admin-desktop.png) |
| Sidebar/composer | Desktop | ar-XB | Passed | [sidebar](../evidence/frontend-platform/2026-08-01/rtl-sidebar-desktop.png), [composer](../evidence/frontend-platform/2026-08-01/rtl-compose-desktop.png) |
| Sidebar/composer | Mobile | ar-XB | Passed | [sidebar](../evidence/frontend-platform/2026-08-01/rtl-sidebar-mobile.png), [composer](../evidence/frontend-platform/2026-08-01/rtl-compose-mobile.png) |
| Mixed email/UUID/error text | Mobile | ar-XB | Passed | [rtl-mixed-email-uuid-error-mobile.png](../evidence/frontend-platform/2026-08-01/rtl-mixed-email-uuid-error-mobile.png) |
| Keyboard focus order | Desktop | en | Passed | [en-login-focus-order.png](../evidence/frontend-platform/2026-08-01/en-login-focus-order.png) |
| Keyboard focus order | Desktop | ar-XB | Passed | [rtl-login-focus-order.png](../evidence/frontend-platform/2026-08-01/rtl-login-focus-order.png) |

Screenshots must represent the current tested build. Static code inspection is
not sufficient evidence for this section.

## 14. Full Command Gate

Run from the repository root:

```bash
pnpm install --frozen-lockfile
pnpm i18n:check
pnpm frontend:contracts
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm audit --prod
git diff --check
```

Record:

| Command | Date/time | Status | Output summary or blocker |
| --- | --- | --- | --- |
| `pnpm install --frozen-lockfile` | 2026-08-01 | Passed | Lockfile current; ignored optional build scripts warning. |
| `pnpm i18n:check` | 2026-08-01 | Passed | Resource parity passed. |
| `pnpm frontend:contracts` | 2026-08-01 | Passed | Contract enforcement passed. |
| `pnpm typecheck` | 2026-08-01 | Passed | All six typed workspace packages passed. |
| `pnpm test` | 2026-08-01 | Passed | 56 contracts, 5 config, 12 email-core, 138 web, 202 worker/script, 10 Worker HTTP, 43 integration tests. |
| `pnpm build` | 2026-08-01 | Passed | All workspace builds passed; Vite emitted the existing large-chunk warning. |
| `pnpm test:e2e` | 2026-08-01 | Passed | Fresh Vite port 5192 and new browser contexts; Playwright 46/46 passed with one worker in 17.9s. |
| `pnpm audit --prod` | 2026-08-01 | Passed | No known vulnerabilities. |
| `git diff --check` | 2026-08-01 | Passed | Passed after the acceptance/documentation edits. |

## 15. Preservation Audit

- [x] Pre-implementation `git status --short` was recorded.
- [x] Every task inspected overlapping user diffs before editing.
- [x] No unrelated file was reset, deleted, or reformatted.
- [x] Task commits contain only intended files.
- [x] Current authentication/session behavior remains represented in tests.
- [x] Final diff against the implementation baseline contains only approved
      frontend/contracts/tests/docs/dependency changes.

Evidence:

```bash
git status --short
FRONTEND_BASELINE_SHA="$(git rev-list -n 1 --grep='^docs: plan frontend platform modernization$' HEAD)"
git log --oneline --decorate "${FRONTEND_BASELINE_SHA}..HEAD"
git diff --stat "${FRONTEND_BASELINE_SHA}..HEAD"
git diff --name-status "${FRONTEND_BASELINE_SHA}..HEAD"
```

Status: `Passed` — 2026-08-01 baseline was clean at `dcd628c`; this worktree alone was changed. Final staged-path and original-checkout audits are recorded in the Task 13 report.

## Completion Decision

Mark the frontend complete only when:

1. every Completion Summary row is `Passed`;
2. every required checkbox is checked;
3. manual visual evidence is recorded;
4. every final command is `Passed`;
5. no required check is `Pending`, `Failed`, or `Blocked`; and
6. the preservation audit proves pre-existing user work was retained.

Status: `Passed` — all acceptance sections, required checkboxes, manual visual
evidence, command gates, and preservation checks have passed.
