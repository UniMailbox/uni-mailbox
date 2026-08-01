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

| Gate                           | Status  | Required evidence                                     |
| ------------------------------ | ------- | ----------------------------------------------------- |
| English UI complete            | Pending | English Playwright project and literal assertions     |
| Simplified Chinese UI complete | Pending | Chinese Playwright project and literal assertions     |
| Language preference            | Pending | Unit and E2E persistence evidence                     |
| Error localization             | Pending | Known/unknown/request-ID unit and browser evidence    |
| TanStack Router                | Pending | Route tests, legacy routing scan, browser history E2E |
| TanStack Query service model   | Pending | Key/invalidation tests and component source scan      |
| Endpoint contracts             | Pending | Contract tests, client tests, enforcement script      |
| TanStack Form                  | Pending | Form tests and dependency/source scan                 |
| RTL foundations                | Pending | Desktop/mobile pseudo-RTL E2E                         |
| Compose preservation           | Pending | Focused unit and browser regression suite             |
| Accessibility                  | Pending | Role-based tests and locale-aware browser selectors   |
| Full repository gates          | Pending | Exact command log                                     |
| User-change preservation       | Pending | Baseline and final diff audit                         |

## 1. Locale Runtime

### Automated requirements

- [ ] Valid persisted `en` overrides a Chinese browser locale.
- [ ] Valid persisted `zh-CN` overrides an English browser locale.
- [ ] Every `zh`, `zh-CN`, `zh-SG`, `zh-Hans`, and `zh-Hant` browser locale
      normalizes to `zh-CN`.
- [ ] Unsupported persisted locale falls back to browser detection.
- [ ] Persisted `ar-XB` is rejected in production resolution.
- [ ] Missing/unsupported browser locale falls back to `en`.
- [ ] i18n initialization completes before React render.
- [ ] Language change updates `html.lang`.
- [ ] Language change updates `html.dir` from centralized metadata.
- [ ] Language change updates document title and description.
- [ ] Language change persists production locale.
- [ ] Test-only RTL locale does not persist as a production preference.

Evidence:

```bash
pnpm --filter @unimailbox/web exec vitest run src/i18n/locale.test.ts src/i18n/index.test.ts
```

Status: `Pending`

## 2. Resource Integrity

- [ ] English and Chinese have identical namespace sets.
- [ ] English and Chinese have identical leaf-key sets.
- [ ] English and Chinese interpolation variables match for every key.
- [ ] English and Chinese plural suffix sets match.
- [ ] No production translation value is empty.
- [ ] Every stable ErrorCode has English and Chinese text.
- [ ] Dynamic keys are backed by explicit typed maps.
- [ ] Production resources do not include `ar-XB` in the selectable locale
      list.

Evidence:

```bash
pnpm i18n:check
pnpm --filter @unimailbox/web exec vitest run src/i18n/resources.test.ts
```

Status: `Pending`

## 3. English and Chinese Functional Matrix

Both production locales must complete:

| Workflow                               | en      | zh-CN   |
| -------------------------------------- | ------- | ------- |
| Login screen and validation            | Pending | Pending |
| Safe post-login deep link              | Pending | Pending |
| Inbox list and pagination              | Pending | Pending |
| Folder navigation                      | Pending | Pending |
| Star and move message                  | Pending | Pending |
| Message detail and attachments         | Pending | Pending |
| New Compose and send                   | Pending | Pending |
| Draft restore, save, and send          | Pending | Pending |
| Reply composition                      | Pending | Pending |
| Language preference switch             | Pending | Pending |
| Preference after reload                | Pending | Pending |
| Preference across logout/login         | Pending | Pending |
| Account settings                       | Pending | Pending |
| Mailbox/member settings                | Pending | Pending |
| Cloudflare settings                    | Pending | Pending |
| Storage settings                       | Pending | Pending |
| Administration authorized route        | Pending | Pending |
| Administration forbidden route         | Pending | Pending |
| Localized not-found boundary           | Pending | Pending |
| Localized request error and request ID | Pending | Pending |

Evidence:

```bash
pnpm exec playwright test --project=en
pnpm exec playwright test --project=zh-CN
```

Each critical workflow includes at least one literal assertion in the target
language so translation-resource drift cannot make both UI and test pass.

Status: `Pending`

## 4. Router and Guard Semantics

- [ ] Custom history navigation is removed.
- [ ] Production code has no application `popstate` listener.
- [ ] Routes, params, search, and links use TanStack Router.
- [ ] Unknown paths render localized 404.
- [ ] `/setup` redirects to `/login`.
- [ ] Current `/register` behavior remains explicit.
- [ ] 401 redirects to login with replace semantics.
- [ ] 401 stores only a validated safe destination.
- [ ] `https://`, `//`, `/\\`, login, and register destinations are rejected.
- [ ] 401 parent guard prevents protected child requests.
- [ ] 403 renders forbidden and remains signed in.
- [ ] 503 and 5xx render error boundaries rather than login.
- [ ] Admin resource permissions match the shared permission contract.
- [ ] Back, forward, replace, and deep links behave correctly in a browser.

Evidence:

```bash
pnpm --filter @unimailbox/web exec vitest run src/app/router.test.tsx
pnpm exec playwright test e2e/login.spec.ts
rg -n "pushState|replaceState|popstate|window\\.location\\.pathname" apps/web/src -g '*.ts' -g '*.tsx'
```

Expected source scan: no production custom-router implementation.

Status: `Pending`

## 5. Query Ownership and Cache Correctness

- [ ] Every remote read uses feature-owned Query options.
- [ ] Every query key comes from a feature-owned factory.
- [ ] Equivalent normalized search produces one key.
- [ ] Session Query options are reused by Router guard and components.
- [ ] Message star invalidates/updates detail and list data.
- [ ] Message move invalidates source, destination, and detail.
- [ ] New send invalidates sent/message lists.
- [ ] Draft send invalidates both message and draft data.
- [ ] Attachment completion invalidates attachment data.
- [ ] Mailbox/member mutations invalidate canonical mailbox/member data.
- [ ] Cloudflare/provider mutations invalidate status and related admin data.
- [ ] Admin mutations invalidate the correct resource.
- [ ] No page component constructs an API URL or response interface.
- [ ] Zustand contains no remote server records.

Evidence:

```bash
pnpm --filter @unimailbox/web exec vitest run src/features/auth/api.test.ts src/features/mail/api.test.ts src/features/settings/api.test.ts src/features/admin/api.test.ts
rg -n "queryKey:\\s*\\[" apps/web/src/features -g '*.tsx'
rg -n "apiRequest|apiResponse" apps/web/src/features -g '*.ts' -g '*.tsx'
```

Expected scans: no matches in production feature components.

Status: `Pending`

## 6. Endpoint Contracts and Client

- [ ] Every frontend-used endpoint declares method and path.
- [ ] Params, query, headers, and body are declared when applicable.
- [ ] Every accepted success status has a runtime schema.
- [ ] Every operation declares its media type.
- [ ] 204, binary, and redirect operations are explicit.
- [ ] ETag and idempotency headers are explicit.
- [ ] Caller input and parsed output types are distinct.
- [ ] Successful responses are runtime validated.
- [ ] Malformed success produces `CLIENT_RESPONSE_INVALID`.
- [ ] Legacy `{ data }`, `{ error }`, and `details` remain compatible.
- [ ] Request ID is retained from body or header.
- [ ] Refresh retries exactly once.
- [ ] Login never attempts refresh.
- [ ] Unknown server code becomes `UNKNOWN_SERVER_ERROR` and retains raw code.
- [ ] No final `apiRequest<T>` or raw normal-endpoint response escape hatch
      remains.

Evidence:

```bash
pnpm --filter @unimailbox/contracts test
pnpm --filter @unimailbox/web exec vitest run src/lib/api
pnpm frontend:contracts
```

Status: `Pending`

## 7. Error Safety and Localization

- [ ] Known errors render code-based English text.
- [ ] Known errors render code-based Chinese text.
- [ ] Unknown errors render localized generic text.
- [ ] Raw server message is not visible.
- [ ] Raw storage reason is not visible.
- [ ] Raw provider failure text is not visible.
- [ ] Raw status enums are mapped to translations.
- [ ] Request ID is visible and copyable when supplied.
- [ ] Request ID is LTR-isolated in RTL content.
- [ ] Non-JSON failure is safe and localized.
- [ ] Internal exception text, stack, SQL, token, secret, and credential are
      absent from rendered output.

Evidence:

```bash
pnpm --filter @unimailbox/web exec vitest run src/i18n/errors.test.ts src/components/Status.test.tsx
rg -n "error\\.message|attachments\\.reason|diagnosticMessage" apps/web/src -g '*.tsx'
```

Expected scan: no visible production render of these values.

Status: `Pending`

## 8. TanStack Form and Validation

- [ ] Every form uses the application TanStack Form composition.
- [ ] Every form uses shared/contract-backed Zod validation.
- [ ] No page-local duplicate request schema remains.
- [ ] Validation text is localized from stable issue information.
- [ ] Submit state prevents duplicate submission.
- [ ] Server errors remain separate from field errors.
- [ ] Successful operations reset only the intended values.
- [ ] Async hydration does not overwrite newer user input.
- [ ] Dynamic admin forms use discriminated schemas.
- [ ] `react-hook-form` is absent from production dependencies and source.

Evidence:

```bash
pnpm --filter @unimailbox/web exec vitest run src/lib/form src/features/auth src/features/settings src/features/admin
rg -n "react-hook-form|useForm<|useForm\\(" apps/web/src -g '*.ts' -g '*.tsx'
```

Expected scan: TanStack form imports/usages only; no React Hook Form.

Status: `Pending`

## 9. Compose Preservation

- [ ] Server draft hydrates recipients, subject, body, attachments, and
      version.
- [ ] Reply hydrates recipient, subject prefix, quoted content, and parent ID.
- [ ] Offline draft restores only without server draft or reply.
- [ ] Autosave remains debounced at 400 ms.
- [ ] Attachment upload preserves all other values.
- [ ] Existing draft saves before send with current `if-match`.
- [ ] Successful send removes offline working draft.
- [ ] Successful draft send invalidates messages and drafts.
- [ ] Language switch preserves recipients, subject, body, attachments, reply,
      server draft ID, and version.
- [ ] Direction change does not recreate Tiptap or lose selection-compatible
      editor state.
- [ ] Translated placeholder updates.

Evidence:

```bash
pnpm --filter @unimailbox/web exec vitest run src/features/mail/ComposePanel.test.tsx
pnpm exec playwright test --project=en e2e/inbox.spec.ts
pnpm exec playwright test --project=zh-CN e2e/inbox.spec.ts
```

Status: `Pending`

## 10. RTL and Bidirectional Layout

Both `rtl-desktop` and `rtl-mobile` must prove:

- [ ] `html.dir` is `rtl`.
- [ ] `scrollWidth <= clientWidth`.
- [ ] Sidebar appears at inline-start.
- [ ] Composer appears at inline-end.
- [ ] Back, next, and reply icons mirror.
- [ ] Star, cloud, lock, spinner, and formatting icons do not mirror.
- [ ] Emails remain readable and LTR-isolated.
- [ ] UUIDs/request IDs/codes/paths remain readable and LTR-isolated.
- [ ] Names and subjects use automatic bidi isolation.
- [ ] Error cards do not overflow.
- [ ] Chinese-expanded and pseudo-RTL copy do not clip controls.
- [ ] Mobile off-canvas transforms and shadows follow inline direction.
- [ ] Email iframe direction policy is explicit.

Evidence:

```bash
pnpm exec playwright test --project=rtl-desktop
pnpm exec playwright test --project=rtl-mobile
rg -n "margin-(left|right)|padding-(left|right)|border-(left|right)|text-align:\\s*(left|right)|float:\\s*(left|right)" apps/web/src/styles.css
```

Expected source scan: no unexplained application-layout match.

Status: `Pending`

## 11. Accessibility

- [ ] Every form input has a localized accessible label.
- [ ] Icon-only actions have localized names.
- [ ] Loading uses `role="status"` with `aria-live="polite"` and success uses
      `role="status"`.
- [ ] Error state uses `role="alert"`.
- [ ] Directional icons are decorative when their control is named.
- [ ] E2E primarily uses role and accessible-name selectors.
- [ ] Locale switching does not reduce keyboard access.
- [ ] Visible focus remains on both LTR and RTL layouts.

Evidence:

- Testing Library role/name assertions.
- Playwright keyboard smoke checks in production locales and RTL mobile.
- Manual focus-order check recorded below.

Status: `Pending`

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

Status: `Pending`

## 13. Manual Visual Checks

Record evidence for:

| Check                             | Viewport | Locale | Status  | Evidence |
| --------------------------------- | -------- | ------ | ------- | -------- |
| Login long copy and validation    | Desktop  | zh-CN  | Pending |          |
| Inbox dense list                  | Desktop  | zh-CN  | Pending |          |
| Compose recipients/editor/actions | Desktop  | zh-CN  | Pending |          |
| Settings tabs and preference      | Mobile   | zh-CN  | Pending |          |
| Admin navigation/table/forms      | Desktop  | zh-CN  | Pending |          |
| Sidebar/composer                  | Desktop  | ar-XB  | Pending |          |
| Sidebar/composer                  | Mobile   | ar-XB  | Pending |          |
| Mixed email/UUID/error text       | Mobile   | ar-XB  | Pending |          |
| Keyboard focus order              | Desktop  | en     | Pending |          |
| Keyboard focus order              | Desktop  | ar-XB  | Pending |          |

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

| Command                          | Date/time | Status  | Output summary or blocker |
| -------------------------------- | --------- | ------- | ------------------------- |
| `pnpm install --frozen-lockfile` |           | Pending |                           |
| `pnpm i18n:check`                |           | Pending |                           |
| `pnpm frontend:contracts`        |           | Pending |                           |
| `pnpm typecheck`                 |           | Pending |                           |
| `pnpm test`                      |           | Pending |                           |
| `pnpm build`                     |           | Pending |                           |
| `pnpm test:e2e`                  |           | Pending |                           |
| `pnpm audit --prod`              |           | Pending |                           |
| `git diff --check`               |           | Pending |                           |

## 15. Preservation Audit

- [ ] Pre-implementation `git status --short` was recorded.
- [ ] Every task inspected overlapping user diffs before editing.
- [ ] No unrelated file was reset, deleted, or reformatted.
- [ ] Task commits contain only intended files.
- [ ] Current authentication/session behavior remains represented in tests.
- [ ] Final diff against the implementation baseline contains only approved
      frontend/contracts/tests/docs/dependency changes.

Evidence:

```bash
git status --short
FRONTEND_BASELINE_SHA="$(git rev-list -n 1 --grep='^docs: plan frontend platform modernization$' HEAD)"
git log --oneline --decorate "${FRONTEND_BASELINE_SHA}..HEAD"
git diff --stat "${FRONTEND_BASELINE_SHA}..HEAD"
git diff --name-status "${FRONTEND_BASELINE_SHA}..HEAD"
```

Status: `Pending`

## Completion Decision

Mark the frontend complete only when:

1. every Completion Summary row is `Passed`;
2. every required checkbox is checked;
3. manual visual evidence is recorded;
4. every final command is `Passed`;
5. no required check is `Pending`, `Failed`, or `Blocked`; and
6. the preservation audit proves pre-existing user work was retained.
