# Frontend Platform Modernization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modernize the UniMailbox frontend with complete English and Simplified Chinese localization, future-safe RTL layout, TanStack Router/Query/Form conventions, shared Zod endpoint contracts, and localized code-driven errors.

**Architecture:** Routes and pages consume feature-owned Query/Form options, which call a contract-aware client backed by schemas from `@unimailbox/contracts`. TanStack Router owns URL and guard state, TanStack Query owns server state, TanStack Form owns form state, i18next owns user-visible copy, Zustand remains UI-only, and Dexie remains the offline draft store. The new client remains compatible with the current Worker envelopes while the Worker-wide contract enforcement is deferred.

**Tech Stack:** React 18.3.1, TypeScript 5.6.3, Vite 5.4.21, TanStack Router 1.x, TanStack Query 5.x, TanStack Form 1.x, Zod 3.25.x, i18next, react-i18next, Zustand 5.x, Dexie 4.x, Vitest 2.x, Testing Library, Playwright 1.54.x, pnpm 10.32.1.

## Global Constraints

- Production locales are exactly `en` and `zh-CN`; `ar-XB` is test/development-only.
- Locale preference is browser-local under `unimailbox.locale`; account synchronization is out of scope.
- The frontend phase must remain compatible with `/api/v1`, `{ data }`, `{ error }`, current HTTP statuses, current wire casing, and legacy `details`.
- No server `message`, storage `reason`, or raw status enum may be rendered as product copy.
- Route guards must preserve the distinction between 401, 403, bootstrap/503, and other 5xx failures.
- Post-login redirects accept only root-relative, single-slash, non-authentication paths and reject backslash variants.
- TanStack Query owns remote state; Router owns URL state; TanStack Form owns form state; Zustand and Dexie retain their existing narrow responsibilities.
- Shared Zod schemas express constraints without localized English messages.
- Physical directional CSS must become logical CSS; SVG icons are flipped only when semantically directional.
- Current user changes must be preserved. Stage only files owned by the current task.
- Do not upgrade React, TypeScript, Vite, Zod, Hono, or unrelated dependencies.
- Do not rename current API wire fields while introducing contracts.
- Each task follows red-green-refactor and ends with focused verification and an independently reviewable commit.
- Final acceptance requires every frontend API operation to have an endpoint contract and every form to use TanStack Form.

---

## Design Coverage

| Confirmed design requirement                  | Implementing tasks |
| --------------------------------------------- | ------------------ |
| Locale runtime and persistent preference      | 2, 8               |
| Complete English and Chinese product copy     | 4, 5, 7, 8, 9, 11  |
| Future-safe RTL and bidirectional content     | 2, 11, 12          |
| TanStack Router and guard semantics           | 5                  |
| TanStack Query service model and invalidation | 1, 5, 6, 8, 9      |
| Shared endpoint contracts and typed client    | 3, 5, 6, 8, 9, 13  |
| Code-driven localized errors and request IDs  | 3, 4, 8, 9         |
| TanStack Form and shared Zod validation       | 4, 5, 8, 9, 10, 13 |
| Compose state preservation                    | 7, 10, 12          |
| Rules and enforceable acceptance              | 11, 12, 13         |
| Full verification and preservation audit      | 13                 |

The later Worker enforcement described in the design remains outside this
plan. The frontend compatibility client and shared contracts produced here are
its prerequisite.

---

## Baseline and Ownership

Before Task 1, record:

```bash
git status --short
git diff --name-only
git diff --cached --name-only
git log -3 --oneline
```

The current worktree contains user-owned authentication, session, Worker, E2E,
and documentation changes. Never reset, stash, or overwrite them. Before
editing an overlapping file, inspect its current diff and preserve both the
working copy behavior and the tests that describe it.

## Target File Structure

### New application infrastructure

- `apps/web/src/app/query-client.ts`: production and test Query Client factories.
- `apps/web/src/app/router.tsx`: code-based route tree and typed Router context.
- `apps/web/src/app/router.test.tsx`: memory-history route, guard, boundary, and redirect tests.
- `apps/web/src/routes/boundaries.tsx`: localized pending, error, forbidden, and not-found UI.
- `apps/web/src/i18n/index.ts`: i18next initialization and language-change synchronization.
- `apps/web/src/i18n/locale.ts`: supported locale metadata, detection, and persistence.
- `apps/web/src/i18n/format.ts`: locale-bound date/number/unit formatting.
- `apps/web/src/i18n/errors.ts`: `ApiError` and Zod issue translation adapters.
- `apps/web/src/i18n/test-instance.ts`: isolated test i18n factory.
- `apps/web/src/i18n/resources/{en,zh-CN}/*.json`: production resources.
- `apps/web/src/i18n/resources/ar-XB/*.json`: test-only pseudo-RTL resources.
- `apps/web/src/lib/api/transport.ts`: token, refresh, decode, request-ID, and compatibility transport.
- `apps/web/src/lib/api/client.ts`: contract-aware typed client.
- `apps/web/src/lib/api/index.ts`: configured application API client.
- `apps/web/src/lib/api/errors.ts`: normalized client error types and guards.
- `apps/web/src/lib/form/app-form.tsx`: application TanStack Form composition.
- `apps/web/src/lib/form/field-error.tsx`: translated field-error renderer.
- `apps/web/src/lib/form/validation.ts`: Zod issue to translation-token adapter.

### New shared contracts

- `packages/contracts/src/api/common/endpoint.ts`: endpoint definition helper and inference types.
- `packages/contracts/src/api/common/envelope.ts`: runtime success/error envelope schemas.
- `packages/contracts/src/api/common/errors.ts`: stable frontend error-code registry and parameter schemas.
- `packages/contracts/src/api/common/pagination.ts`: cursor and page schemas.
- `packages/contracts/src/api/auth.ts`
- `packages/contracts/src/api/mailboxes.ts`
- `packages/contracts/src/api/messages.ts`
- `packages/contracts/src/api/drafts.ts`
- `packages/contracts/src/api/attachments.ts`
- `packages/contracts/src/api/administration.ts`
- `packages/contracts/src/api/endpoints.ts`

### New feature API modules

- `apps/web/src/features/auth/api.ts`
- `apps/web/src/features/mail/api.ts`
- `apps/web/src/features/settings/api.ts`
- `apps/web/src/features/admin/api.ts`

### Rule and acceptance artifacts

- `docs/rules/frontend-platform.md`
- `docs/plans/frontend-platform-acceptance.md`

The plan does not require splitting every existing page immediately. A page
may remain in its existing file while its API, routing, form, and localization
responsibilities move to the focused modules above.

---

### Task 1: Add frontend platform dependencies and deterministic client factories

**Files:**

- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `apps/web/src/app/query-client.ts`
- Create: `apps/web/src/app/query-client.test.ts`
- Modify: `apps/web/src/main.tsx`
- Modify: `apps/web/src/App.test.tsx`

**Interfaces:**

- Produces:
  - `createAppQueryClient(): QueryClient`
  - `createTestQueryClient(): QueryClient`
- Consumes: none.

- [ ] **Step 1: Write the failing Query Client factory tests**

```ts
import { describe, expect, it } from "vitest";
import { createAppQueryClient, createTestQueryClient } from "./query-client";

describe("query client policy", () => {
  it("uses the production freshness and retry policy", () => {
    const client = createAppQueryClient();
    expect(client.getDefaultOptions().queries).toMatchObject({
      staleTime: 15_000,
      retry: 1,
      refetchOnWindowFocus: true,
    });
  });

  it("disables retries in tests", () => {
    const client = createTestQueryClient();
    expect(client.getDefaultOptions().queries?.retry).toBe(false);
    expect(client.getDefaultOptions().mutations?.retry).toBe(false);
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm --filter @unimailbox/web exec vitest run src/app/query-client.test.ts
```

Expected: FAIL because `src/app/query-client.ts` does not exist.

- [ ] **Step 3: Add exact frontend dependencies**

Run:

```bash
pnpm --filter @unimailbox/web add @tanstack/react-router@^1 @tanstack/react-form@^1 i18next@^25 react-i18next@^15
```

Do not remove `react-hook-form` in this task.

- [ ] **Step 4: Implement the Query Client factories**

```ts
import { QueryClient } from "@tanstack/react-query";

export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        retry: 1,
        refetchOnWindowFocus: true,
      },
      mutations: { retry: false },
    },
  });
}

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}
```

Replace the inline client in `main.tsx` and the repeated client setup in
`App.test.tsx` with these factories. Do not change routing in this task.

- [ ] **Step 5: Run focused tests and frontend typecheck**

Run:

```bash
pnpm --filter @unimailbox/web exec vitest run src/app/query-client.test.ts src/App.test.tsx
pnpm --filter @unimailbox/web typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit only Task 1 files**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/src/app/query-client.ts apps/web/src/app/query-client.test.ts apps/web/src/main.tsx apps/web/src/App.test.tsx
git commit -m "chore(web): add frontend platform foundations"
```

---

### Task 2: Implement locale detection, persistence, resources, and document synchronization

**Files:**

- Create: `apps/web/src/i18n/locale.ts`
- Create: `apps/web/src/i18n/locale.test.ts`
- Create: `apps/web/src/i18n/index.ts`
- Create: `apps/web/src/i18n/index.test.ts`
- Create: `apps/web/src/i18n/format.ts`
- Create: `apps/web/src/i18n/format.test.ts`
- Create: `apps/web/src/i18n/test-instance.ts`
- Create: `apps/web/src/i18n/resources/en/common.json`
- Create: `apps/web/src/i18n/resources/zh-CN/common.json`
- Create: `apps/web/src/i18n/resources/ar-XB/common.json`
- Modify: `apps/web/src/main.tsx`
- Modify: `apps/web/index.html`
- Modify: `apps/web/src/test/setup.ts`

**Interfaces:**

- Produces:
  - `type SupportedLocale = "en" | "zh-CN"`
  - `type RuntimeLocale = SupportedLocale | "ar-XB"`
  - `LOCALE_STORAGE_KEY = "unimailbox.locale"`
  - `localeMetadata`
  - `resolveInitialLocale(storage, languages, allowTestLocale): RuntimeLocale`
  - `initializeI18n(): Promise<i18n>`
  - `createTestI18n(locale): i18n`
  - `formatDate(value, locale)`
  - `formatNumber(value, locale)`
- Consumes: dependencies from Task 1.

- [ ] **Step 1: Write failing locale resolution tests**

```ts
describe("resolveInitialLocale", () => {
  it("prefers a valid persisted locale", () => {
    expect(resolveInitialLocale("zh-CN", ["en-SG"])).toBe("zh-CN");
  });

  it("normalizes every Chinese browser locale", () => {
    expect(resolveInitialLocale(null, ["zh-Hant-TW", "en"])).toBe("zh-CN");
  });

  it("rejects test-only and unknown persisted locales in production", () => {
    expect(resolveInitialLocale("ar-XB", ["en-SG"], false)).toBe("en");
    expect(resolveInitialLocale("fr", ["zh-SG"])).toBe("zh-CN");
  });

  it("allows pseudo RTL only in test or development", () => {
    expect(resolveInitialLocale("ar-XB", ["en-SG"], true)).toBe("ar-XB");
  });
});
```

- [ ] **Step 2: Run locale tests and verify RED**

Run:

```bash
pnpm --filter @unimailbox/web exec vitest run src/i18n/locale.test.ts
```

Expected: FAIL because the locale module does not exist.

- [ ] **Step 3: Implement locale metadata and resolver**

```ts
export const LOCALE_STORAGE_KEY = "unimailbox.locale";

export const localeMetadata = {
  en: { languageTag: "en", direction: "ltr" },
  "zh-CN": { languageTag: "zh-CN", direction: "ltr" },
  "ar-XB": { languageTag: "ar-XB", direction: "rtl", testOnly: true },
} as const;

export type RuntimeLocale = keyof typeof localeMetadata;
export type SupportedLocale = Exclude<RuntimeLocale, "ar-XB">;

export function resolveInitialLocale(
  stored: string | null,
  languages: readonly string[],
  allowTestLocale = false,
): RuntimeLocale {
  if (stored === "en" || stored === "zh-CN") return stored;
  if (stored === "ar-XB" && allowTestLocale) return stored;
  return languages.some((language) => /^zh(?:-|$)/iu.test(language))
    ? "zh-CN"
    : "en";
}
```

- [ ] **Step 4: Write failing document synchronization tests**

The test must change from `en` to `zh-CN` and assert:

```ts
expect(document.documentElement.lang).toBe("zh-CN");
expect(document.documentElement.dir).toBe("ltr");
expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("zh-CN");
expect(document.title).toBe("UniMailbox");
expect(
  document.querySelector('meta[name="description"]')?.getAttribute("content"),
).toBe("安全、私有的邮件工作区");
```

It must also initialize `ar-XB` through `createTestI18n` and assert
`document.documentElement.dir === "rtl"` without persisting it.

- [ ] **Step 5: Add locale-bound formatter tests and implementation**

Use fixed UTC values and assert English and Chinese date output. Implement
formatters that always receive `i18n.resolvedLanguage` or an explicit
`RuntimeLocale`; never construct `Intl.DateTimeFormat(undefined)` or
`Intl.NumberFormat(undefined)`.

- [ ] **Step 6: Add the initial resource shape and i18next initialization**

The common resources begin with identical keys:

```json
{
  "meta": {
    "title": "UniMailbox",
    "description": "Secure, private mail workspace"
  },
  "actions": {
    "retry": "Retry",
    "close": "Close",
    "save": "Save",
    "cancel": "Cancel"
  },
  "states": {
    "loading": "Loading",
    "requestFailed": "That request did not complete",
    "tryAgain": "Please try again."
  }
}
```

The Chinese resource uses the same leaf keys and Chinese values. The
pseudo-RTL resource uses visibly expanded test text and is registered only
when `import.meta.env.DEV || import.meta.env.MODE === "test"`.

`initializeI18n` passes
`import.meta.env.DEV || import.meta.env.MODE === "test"` as
`allowTestLocale` and must:

1. resolve the initial locale;
2. initialize i18next before render;
3. subscribe to `languageChanged`;
4. synchronize `lang`, `dir`, title, description, and persistence; and
5. return the initialized instance.

- [ ] **Step 7: Gate React rendering on i18n initialization**

Replace immediate rendering in `main.tsx` with:

```ts
void initializeI18n().then(() => {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </React.StrictMode>,
  );
});
```

Keep the current application component until Router migration.

- [ ] **Step 8: Run focused tests, typecheck, and build**

Run:

```bash
pnpm --filter @unimailbox/web exec vitest run src/i18n/locale.test.ts src/i18n/index.test.ts src/i18n/format.test.ts
pnpm --filter @unimailbox/web typecheck
pnpm --filter @unimailbox/web build
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/i18n apps/web/src/main.tsx apps/web/src/test/setup.ts apps/web/index.html
git commit -m "feat(web): add locale runtime"
```

---

### Task 3: Define endpoint primitives, error envelopes, and typed transport

**Files:**

- Create: `packages/contracts/src/api/common/endpoint.ts`
- Create: `packages/contracts/src/api/common/envelope.ts`
- Create: `packages/contracts/src/api/common/errors.ts`
- Create: `packages/contracts/src/api/common/pagination.ts`
- Create: `packages/contracts/src/api/endpoints.ts`
- Create: `packages/contracts/test/endpoint.test.ts`
- Modify: `packages/contracts/src/api/index.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `apps/web/src/lib/api/errors.ts`
- Create: `apps/web/src/lib/api/transport.ts`
- Create: `apps/web/src/lib/api/transport.test.ts`
- Create: `apps/web/src/lib/api/client.ts`
- Create: `apps/web/src/lib/api/client.test.ts`
- Create: `apps/web/src/lib/api/index.ts`
- Modify: `apps/web/src/lib/api.ts`

**Interfaces:**

- Produces:
  - `defineEndpoint(definition)`
  - `EndpointRequest<TEndpoint>`
  - `EndpointResponse<TEndpoint>`
  - `ERROR_CODES`, `ErrorCode`, `ApiErrorEnvelopeSchema`
  - `ApiClientError`
  - `createApiTransport(options)`
  - `createApiClient(transport)`
  - configured singleton `apiClient`
- Consumes: Zod 3.25.x and the current access-token storage behavior.

- [ ] **Step 1: Write failing endpoint inference and envelope tests**

```ts
const login = defineEndpoint({
  method: "POST",
  path: "/auth/login",
  request: { body: z.object({ email: z.string().email() }) },
  responses: { 200: z.object({ accessToken: z.string() }) },
  errors: ["AUTH_REQUIRED"],
  mediaType: "json",
});

expect(login.method).toBe("POST");
expect(
  ApiErrorEnvelopeSchema.parse({
    error: {
      code: "AUTH_REQUIRED",
      message: "Authentication required",
      requestId: "request-1",
    },
  }),
).toMatchObject({ error: { code: "AUTH_REQUIRED" } });
```

Add compile-time cases using `expectTypeOf` and `@ts-expect-error` so a login
body without email and an unsupported response status fail compilation.

- [ ] **Step 2: Run contract tests and verify RED**

Run:

```bash
pnpm --filter @unimailbox/contracts exec vitest run test/endpoint.test.ts
```

Expected: FAIL because the common contract modules do not exist.

- [ ] **Step 3: Implement endpoint and envelope primitives**

`defineEndpoint` must preserve literal method, path, statuses, errors, and media
type. Request members are optional schemas:

```ts
type EndpointDefinition = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  request?: {
    params?: z.ZodTypeAny;
    query?: z.ZodTypeAny;
    headers?: z.ZodTypeAny;
    body?: z.ZodTypeAny;
  };
  responses: Record<number, z.ZodTypeAny | null>;
  errors: readonly ErrorCode[];
  mediaType: "json" | "empty" | "binary" | "redirect";
};
```

The error envelope accepts current `details` and future `params`, always
requires `code` and safe fallback `message`, and accepts `requestId` for
compatibility while transport may recover it from the header.

- [ ] **Step 4: Write failing transport compatibility tests**

Cover these exact cases:

- 204 returns `undefined`;
- `{ data }` returns data;
- known error preserves `code`, `status`, and body `requestId`;
- header request ID is used when the body lacks one;
- unknown code becomes `UNKNOWN_SERVER_ERROR` and retains `rawCode`;
- non-JSON error becomes a safe generic error;
- malformed success JSON becomes `CLIENT_RESPONSE_INVALID`;
- 401 attempts refresh once and retries once;
- refresh failure clears the token and does not recurse; and
- `/auth/login` never attempts refresh.

Example assertion:

```ts
await expect(transport.request("/protected")).rejects.toMatchObject({
  code: "AUTH_REQUIRED",
  status: 401,
  requestId: "request-1",
});
```

- [ ] **Step 5: Implement `ApiClientError` and transport**

```ts
export class ApiClientError extends Error {
  readonly rawCode?: string;
  readonly params?: unknown;
  readonly requestId?: string;
  readonly diagnosticMessage?: string;

  constructor(
    readonly code:
      | ErrorCode
      | "UNKNOWN_SERVER_ERROR"
      | "CLIENT_RESPONSE_INVALID",
    readonly status: number,
    options: {
      rawCode?: string;
      params?: unknown;
      requestId?: string;
      diagnosticMessage?: string;
    } = {},
  ) {
    super(code);
    this.name = "ApiClientError";
    this.rawCode = options.rawCode;
    this.params = options.params;
    this.requestId = options.requestId;
    this.diagnosticMessage = options.diagnosticMessage;
  }
}
```

Keep token access compatible with the existing session-storage key. The
transport owns refresh and decoding; the typed client owns contract parsing,
path/query construction, and response status selection.

`apps/web/src/lib/api/index.ts` creates the application transport with base
path `/api/v1` and exports the configured `apiClient`. Feature modules import
this instance; tests inject a client or mock transport rather than mutating the
singleton.

`packages/contracts/src/api/endpoints.ts` exports the accumulated endpoint
registry. Later domain tasks add their endpoint groups to this registry.

- [ ] **Step 6: Preserve a deprecated compatibility wrapper**

Refactor `apps/web/src/lib/api.ts` to delegate to the transport while preserving
the existing exports until all call sites migrate. Mark `apiRequest`,
`apiResponse`, and `jsonBody` as deprecated in JSDoc. Do not delete them.

- [ ] **Step 7: Run contract/client tests and existing API tests**

Run:

```bash
pnpm --filter @unimailbox/contracts test
pnpm --filter @unimailbox/web exec vitest run src/lib/api.test.ts src/lib/api-extended.test.ts src/lib/api/transport.test.ts src/lib/api/client.test.ts
pnpm --filter @unimailbox/web typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/contracts/src packages/contracts/test/endpoint.test.ts apps/web/src/lib/api.ts apps/web/src/lib/api
git commit -m "feat(api): add typed frontend transport"
```

---

### Task 4: Add translated API and form error adapters with TanStack Form composition

**Files:**

- Create: `apps/web/src/i18n/errors.ts`
- Create: `apps/web/src/i18n/errors.test.ts`
- Create: `apps/web/src/i18n/resources/en/errors.json`
- Create: `apps/web/src/i18n/resources/zh-CN/errors.json`
- Create: `apps/web/src/i18n/resources/ar-XB/errors.json`
- Create: `apps/web/src/lib/form/app-form.tsx`
- Create: `apps/web/src/lib/form/field-error.tsx`
- Create: `apps/web/src/lib/form/validation.ts`
- Create: `apps/web/src/lib/form/validation.test.ts`
- Modify: `apps/web/src/components/Status.tsx`
- Modify: `apps/web/src/components/Status.test.tsx`

**Interfaces:**

- Produces:
  - `apiErrorToken(error): { key; values; requestId? }`
  - `zodIssueToken(issue): { key; values }`
  - `useAppForm`
  - `TextField`, `PasswordField`, `SubmitButton`, `FieldError`
- Consumes: `ApiClientError` and ErrorCode registry from Task 3.

- [ ] **Step 1: Write failing localization adapter tests**

```ts
it("localizes a known API code without rendering the server message", () => {
  const error = new ApiClientError("AUTH_REQUIRED", 401, {
    requestId: "request-1",
    diagnosticMessage: "server-only English",
  });
  const token = apiErrorToken(error);
  expect(token).toEqual({
    key: "errors:api.AUTH_REQUIRED",
    values: {},
    requestId: "request-1",
  });
});

it("uses a generic localized token for unknown failures", () => {
  expect(apiErrorToken(new Error("raw text")).key).toBe(
    "errors:api.UNKNOWN_SERVER_ERROR",
  );
});
```

Add Zod tests for `too_small`, `too_big`, `invalid_string`, and `invalid_type`.
The token values include only the field label key and safe numeric limits.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm --filter @unimailbox/web exec vitest run src/i18n/errors.test.ts src/lib/form/validation.test.ts
```

Expected: FAIL because adapters do not exist.

- [ ] **Step 3: Implement resource-complete error tokens**

English and Chinese resources must contain identical keys for every value in
`ERROR_CODES`, plus:

- `api.UNKNOWN_SERVER_ERROR`
- `api.CLIENT_RESPONSE_INVALID`
- `validation.required`
- `validation.email`
- `validation.minLength`
- `validation.maxLength`
- `validation.invalidType`

The renderer must never use `diagnosticMessage` as visible fallback.

- [ ] **Step 4: Create the application Form composition**

Use `createFormHookContexts` and `createFormHook` from
`@tanstack/react-form`. `TextField` and `PasswordField` receive translated
label, placeholder, autocomplete, and input-mode props. `FieldError` renders
issues only after touch or submit. `SubmitButton` subscribes to
`canSubmit` and `isSubmitting`.

- [ ] **Step 5: Refactor `Status` components**

`LoadingState` default label comes from `common:states.loading`.
`ErrorState` uses `apiErrorToken`, renders a localized title/body, includes a
copyable request ID when present, and localizes Retry. It must not render
`error.message`.

- [ ] **Step 6: Run focused tests and typecheck**

Run:

```bash
pnpm --filter @unimailbox/web exec vitest run src/i18n/errors.test.ts src/lib/form/validation.test.ts src/components/Status.test.tsx
pnpm --filter @unimailbox/web typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/i18n apps/web/src/lib/form apps/web/src/components/Status.tsx apps/web/src/components/Status.test.tsx
git commit -m "feat(web): localize client and form errors"
```

---

### Task 5: Migrate authentication and application routing to TanStack Router

**Files:**

- Create: `packages/contracts/src/api/auth.ts`
- Create: `packages/contracts/test/auth-endpoints.test.ts`
- Create: `apps/web/src/features/auth/api.ts`
- Create: `apps/web/src/features/auth/api.test.ts`
- Create: `apps/web/src/app/router.tsx`
- Create: `apps/web/src/app/router.test.tsx`
- Create: `apps/web/src/routes/boundaries.tsx`
- Modify: `apps/web/src/main.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.test.tsx`
- Modify: `apps/web/src/features/auth/LoginPage.tsx`
- Modify: `apps/web/src/lib/session.ts`
- Create: `apps/web/src/i18n/resources/en/auth.json`
- Create: `apps/web/src/i18n/resources/zh-CN/auth.json`
- Create: `apps/web/src/i18n/resources/ar-XB/auth.json`
- Modify: `apps/web/src/i18n/index.ts`
- Delete after equivalent coverage: `apps/web/src/lib/navigation.tsx`
- Delete after equivalent coverage: `apps/web/src/lib/navigation.test.ts`
- Delete after equivalent coverage: `apps/web/src/features/auth/RequireSession.tsx`

**Interfaces:**

- Produces:
  - `authEndpoints`
  - `sessionQueryOptions()`
  - `loginMutationOptions(queryClient)`
  - `logoutMutationOptions(queryClient)`
  - `createAppRouter({ queryClient, history? })`
  - `RouterContext`
- Consumes: endpoint client, Query Client, i18n, and app form from Tasks 1–4.

- [ ] **Step 1: Write failing auth endpoint tests**

Define and test contracts for:

- `POST /auth/login`
- `POST /auth/logout`
- `POST /auth/refresh`
- `GET /auth/session`
- `PATCH /auth/email`
- `POST /auth/password/reset`

The tests parse current request and response examples, including the full
`SessionProfile` permissions array and current token response.

- [ ] **Step 2: Implement auth contracts and Query options**

```ts
export const authKeys = {
  all: ["auth"] as const,
  session: () => [...authKeys.all, "session"] as const,
};

export function sessionQueryOptions() {
  return queryOptions({
    queryKey: authKeys.session(),
    queryFn: () => apiClient.call(authEndpoints.session, {}),
    staleTime: 15_000,
    retry: false,
  });
}
```

Login stores the access token, invalidates the session key, then navigates to
the validated destination. Logout clears the access token and removes
authenticated Query data.

Add the auth endpoint group to
`packages/contracts/src/api/endpoints.ts`.

- [ ] **Step 3: Write Router behavior tests with memory history**

Port every behavioral assertion from `App.test.tsx` and
`navigation.test.ts`. Add explicit tests for:

- localized login route;
- `/setup` redirect;
- every protected folder/settings/admin/message route;
- no protected request after a 401 guard failure;
- replace rather than push on login redirect;
- 503 and 500 error boundaries;
- member 403 without login redirect;
- per-resource admin permissions;
- safe post-login destination;
- rejection of `https://`, `//`, `/\\`, login, and register destinations;
- localized 404 for an unknown path; and
- browser back/forward behavior.

- [ ] **Step 4: Implement the code-based route tree**

`RouterContext` contains:

```ts
export interface RouterContext {
  queryClient: QueryClient;
}
```

The authenticated layout calls:

```ts
beforeLoad: async ({ context, location }) => {
  try {
    return {
      session: await context.queryClient.ensureQueryData(sessionQueryOptions()),
    };
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 401) {
      throw redirect({
        to: "/login",
        search: { next: safeLoginTarget(location.href) },
        replace: true,
      });
    }
    throw error;
  }
};
```

Admin child guards assert the matching
`ADMIN_RESOURCE_PERMISSIONS[resource]` and throw a typed forbidden error.

- [ ] **Step 5: Migrate Login to TanStack Form and localized resources**

Use the shared `LoginSchema`, `useAppForm`, the auth mutation, Router
navigation, and `auth` resource keys. Remove the page-local login schema and
React Hook Form usage.

- [ ] **Step 6: Switch `main.tsx` to RouterProvider**

The provider order is:

```tsx
<I18nextProvider i18n={i18n}>
  <QueryClientProvider client={queryClient}>
    <RouterProvider router={router} context={{ queryClient }} />
  </QueryClientProvider>
</I18nextProvider>
```

Do not keep two history owners active.

- [ ] **Step 7: Run focused tests and browser login test**

Run:

```bash
pnpm --filter @unimailbox/contracts exec vitest run test/auth-endpoints.test.ts
pnpm --filter @unimailbox/web exec vitest run src/features/auth/api.test.ts src/app/router.test.tsx src/App.test.tsx
pnpm --filter @unimailbox/web typecheck
pnpm --filter @unimailbox/web build
pnpm exec playwright test e2e/login.spec.ts
```

Expected: PASS.

- [ ] **Step 8: Delete old routing only after equivalence passes**

Delete `navigation.tsx`, `navigation.test.ts`, `RequireSession.tsx`, and the
old pathname dispatch from `App.tsx`. Keep `App.tsx` only if it remains a
focused provider/shell component; otherwise delete it and update imports.

- [ ] **Step 9: Commit**

```bash
git add packages/contracts/src/api packages/contracts/test/auth-endpoints.test.ts apps/web/src/features/auth apps/web/src/app/router.tsx apps/web/src/app/router.test.tsx apps/web/src/routes/boundaries.tsx apps/web/src/main.tsx apps/web/src/App.tsx apps/web/src/App.test.tsx apps/web/src/lib/session.ts apps/web/src/lib/navigation.tsx apps/web/src/lib/navigation.test.ts apps/web/src/i18n
git commit -m "feat(web): adopt typed application routing"
```

---

### Task 6: Contract and centralize mailbox, message, draft, and attachment data

**Files:**

- Create: `packages/contracts/src/api/mailboxes.ts`
- Create: `packages/contracts/src/api/messages.ts`
- Create: `packages/contracts/src/api/drafts.ts`
- Create: `packages/contracts/src/api/attachments.ts`
- Create: `packages/contracts/test/mail-endpoints.test.ts`
- Create: `apps/web/src/features/mail/api.ts`
- Create: `apps/web/src/features/mail/api.test.ts`
- Modify: `apps/web/src/features/mail/MailWorkspace.tsx`
- Modify: `apps/web/src/features/mail/MessagePage.tsx`

**Interfaces:**

- Produces:
  - `mailboxEndpoints`, `messageEndpoints`, `draftEndpoints`,
    `attachmentEndpoints`
  - `mailKeys`
  - `mailboxesQueryOptions()`
  - `messagesInfiniteQueryOptions(input)`
  - `messageQueryOptions(id)`
  - `draftsQueryOptions()`
  - `draftQueryOptions(id)`
  - mutation factories with affected-key invalidation
- Consumes: client and Router from prior tasks.

- [ ] **Step 1: Write failing current-wire contract tests**

Cover every frontend-used operation:

- list/create/get mailbox;
- list/add/update/remove mailbox members;
- list/detail/star/move messages;
- send message;
- list/detail/create/update/send drafts;
- list message attachments;
- create/complete attachment upload; and
- binary attachment download.

Use actual response examples from current Worker tests. Preserve current
snake-case fields such as `display_name`, `html_body`, `text_body`, and
`updated_at`.

- [ ] **Step 2: Implement domain contracts**

Path UUIDs use a shared UUID schema. Folder is:

```ts
z.enum(["inbox", "sent", "drafts", "starred", "archive", "trash"]);
```

ETag and idempotency headers are explicit schemas. Binary download uses
`mediaType: "binary"` and returns a response object containing Blob and
content-disposition metadata rather than raw `Response`.

Add the mailbox, message, draft, and attachment endpoint groups to
`packages/contracts/src/api/endpoints.ts`.

- [ ] **Step 3: Write failing query-key and invalidation tests**

Assert:

```ts
expect(
  mailKeys.messages({
    mailboxId: "mailbox-1",
    folder: "inbox",
    search: "  urgent  ",
  }),
).toEqual(["mail", "messages", "mailbox-1", "inbox", "urgent"]);
```

Assert mutation effects:

- star updates/invalidates message detail and all relevant message lists;
- move invalidates source/destination lists and detail;
- send invalidates sent/messages and drafts when a draft was sent;
- upload completion invalidates attachment lists; and
- mailbox/member changes invalidate their canonical keys.

- [ ] **Step 4: Implement feature Query/Mutation options**

Use `queryOptions` and `infiniteQueryOptions`. Components must not declare
query keys, URLs, response interfaces, or raw `apiRequest` calls after
migration.

- [ ] **Step 5: Migrate MailWorkspace and MessagePage data access**

Use typed Router params/links and domain options while preserving current
visible copy until Task 7 performs the complete mail localization. Attachment
downloads must use the binary contract. No URL, query key, response interface,
or compatibility API call remains in these components.

- [ ] **Step 6: Run tests**

Run:

```bash
pnpm --filter @unimailbox/contracts exec vitest run test/mail-endpoints.test.ts
pnpm --filter @unimailbox/web exec vitest run src/features/mail/api.test.ts src/App.test.tsx
pnpm --filter @unimailbox/web typecheck
pnpm exec playwright test e2e/inbox.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/contracts/src/api packages/contracts/test/mail-endpoints.test.ts apps/web/src/features/mail apps/web/src/i18n/resources
git commit -m "feat(mail): centralize typed mail data"
```

---

### Task 7: Establish Compose regressions and complete mail localization

**Files:**

- Create: `apps/web/src/features/mail/ComposePanel.test.tsx`
- Modify: `apps/web/src/features/mail/ComposePanel.tsx`
- Create: `apps/web/src/i18n/resources/en/mail.json`
- Create: `apps/web/src/i18n/resources/zh-CN/mail.json`
- Create: `apps/web/src/i18n/resources/ar-XB/mail.json`
- Modify: `apps/web/src/features/mail/MailWorkspace.tsx`
- Modify: `apps/web/src/features/mail/MessagePage.tsx`
- Modify: `apps/web/src/lib/drafts-db.ts` only if test injection requires it

**Interfaces:**

- Produces: fully localized mail UI and a locked Compose behavior baseline.
- Consumes: mail contracts/options and the locale runtime.

- [ ] **Step 1: Write Compose state regression tests before changing the form**

Use fake IndexedDB and controlled API responses to prove:

- server draft hydrates to/cc/bcc/subject/body/attachments/version;
- reply hydrates recipient, subject prefix, quoted body, and parent ID;
- local draft restores only when no server draft or reply exists;
- autosave remains debounced at 400 ms;
- upload preserves existing form state;
- send existing draft performs save then send with `if-match`;
- successful send deletes local working draft and invalidates messages/drafts;
- switching `en` to `zh-CN` retains all field and editor contents; and
- translated validation rejects an empty `to` recipient.

- [ ] **Step 2: Run Compose tests and establish baseline**

Run:

```bash
pnpm --filter @unimailbox/web exec vitest run src/features/mail/ComposePanel.test.tsx
```

Expected: existing-behavior tests PASS before the later form migration; new
language expectations FAIL.

- [ ] **Step 3: Make the editor placeholder language-reactive**

On language change, update the Placeholder extension configuration or dispatch
the smallest editor refresh supported by Tiptap. Do not destroy and recreate
the editor. The regression test must retain the HTML and selection-compatible
state.

- [ ] **Step 4: Replace every visible mail string**

Translate folders, actions, empty states, composer controls, attachment
states, statuses, dates, accessible names, iframe titles, and screen-reader
text. Use complete translation units and plural keys.

Keep React Hook Form in Compose during this task. Task 10 performs the final
form migration after Settings and Administration forms have proven the shared
TanStack Form composition.

- [ ] **Step 5: Run focused and browser tests**

Run:

```bash
pnpm --filter @unimailbox/web exec vitest run src/features/mail/ComposePanel.test.tsx src/features/mail/api.test.ts
pnpm --filter @unimailbox/web typecheck
pnpm --filter @unimailbox/web build
pnpm exec playwright test e2e/inbox.spec.ts e2e/setup.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/mail apps/web/src/i18n/resources apps/web/src/lib/drafts-db.ts
git commit -m "feat(mail): localize compose workflows"
```

---

### Task 8: Migrate Settings, language preference, Cloudflare, and storage

**Files:**

- Create: `packages/contracts/src/api/administration.ts`
- Create: `packages/contracts/test/settings-endpoints.test.ts`
- Create: `apps/web/src/features/settings/api.ts`
- Create: `apps/web/src/features/settings/api.test.ts`
- Modify: `apps/web/src/features/settings/SettingsPage.tsx`
- Modify: `apps/web/src/features/settings/SettingsPage.test.tsx`
- Modify: `apps/web/src/features/settings/CloudflareSettings.tsx`
- Create: `apps/web/src/features/settings/CloudflareSettings.test.tsx`
- Modify: `apps/web/src/features/settings/StorageSettings.tsx`
- Create: `apps/web/src/features/settings/StorageSettings.test.tsx`
- Create: `apps/web/src/i18n/resources/en/settings.json`
- Create: `apps/web/src/i18n/resources/zh-CN/settings.json`
- Create: `apps/web/src/i18n/resources/ar-XB/settings.json`
- Modify: `apps/web/src/app/router.tsx`

**Interfaces:**

- Produces:
  - settings endpoint subset and `settingsKeys`
  - settings query/mutation options
  - `/settings/preferences`
- Consumes: locale service, app form, typed client, Router, and mailboxes/member contracts.

- [ ] **Step 1: Write endpoint tests for every Settings call**

Cover:

- identity email and password changes;
- mailbox create and member management;
- Cloudflare status, OAuth start/revoke, account verification, domain setup,
  inbound test, Brevo configuration, and outbound test;
- infrastructure status; and
- R2 verification.

Model the current Worker response exactly. Where storage currently returns a
raw reason, keep it in the wire schema but map it to a finite frontend state;
never render it.

- [ ] **Step 2: Write failing preferences behavior tests**

```ts
it("changes language immediately and persists it", async () => {
  renderSettings("/settings/preferences", { locale: "en" });
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Language" }),
    "zh-CN",
  );
  expect(document.documentElement.lang).toBe("zh-CN");
  expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("zh-CN");
  expect(screen.getByRole("heading", { name: "语言与地区" })).toBeVisible();
});
```

Also assert that `ar-XB` is absent from the production picker.

- [ ] **Step 3: Implement settings contracts and Query options**

Centralize all settings query keys and mutation invalidations. Cloudflare
domain and provider mutations invalidate both checkpoint/status data and the
corresponding administration domain/provider lists.

Add the settings-used endpoint group to
`packages/contracts/src/api/endpoints.ts`.

- [ ] **Step 4: Add the preferences route and tab**

Add `preferences` to the typed settings route. The selector calls
`i18n.changeLanguage`; it has no Save button. The account, mailbox,
Cloudflare, and storage tabs retain their current URLs and permissions.

- [ ] **Step 5: Migrate all Settings forms**

Use `useAppForm` and shared contract request schemas. Remove React Hook Form
from SettingsPage and CloudflareSettings. Preserve:

- post-email/password forced-login behavior;
- mailbox form reset and query invalidation;
- member add/update/remove behavior;
- Cloudflare checkpoint refresh; and
- storage verification behavior.

- [ ] **Step 6: Localize settings and remove raw server text**

Translate tabs, headings, cards, forms, status labels, accessible names, and
success notes. Map infrastructure and storage states to translation keys.
Never render `attachments.reason`.

- [ ] **Step 7: Run tests**

Run:

```bash
pnpm --filter @unimailbox/contracts exec vitest run test/settings-endpoints.test.ts
pnpm --filter @unimailbox/web exec vitest run src/features/settings
pnpm --filter @unimailbox/web typecheck
pnpm --filter @unimailbox/web build
pnpm exec playwright test e2e/setup.spec.ts e2e/setup-extras.spec.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/contracts/src/api packages/contracts/test/settings-endpoints.test.ts apps/web/src/features/settings apps/web/src/i18n/resources apps/web/src/app/router.tsx
git commit -m "feat(settings): add localized typed preferences"
```

---

### Task 9: Contract, localize, and migrate Administration

**Files:**

- Modify: `packages/contracts/src/api/administration.ts`
- Create: `packages/contracts/test/administration-endpoints.test.ts`
- Create: `apps/web/src/features/admin/api.ts`
- Create: `apps/web/src/features/admin/api.test.ts`
- Modify: `apps/web/src/features/admin/AdminPage.tsx`
- Create: `apps/web/src/features/admin/AdminPage.test.tsx`
- Create: `apps/web/src/i18n/resources/en/admin.json`
- Create: `apps/web/src/i18n/resources/zh-CN/admin.json`
- Create: `apps/web/src/i18n/resources/ar-XB/admin.json`

**Interfaces:**

- Produces:
  - `administrationEndpoints`
  - `adminKeys`
  - per-resource create/update/delete schemas and mutation options
- Consumes: shared permission mapping, app form, Router, client, and i18n.

- [ ] **Step 1: Write endpoint tests for every Administration operation**

Cover list/create/update/delete for users, roles, domains, and provider
connections; signature get/save; settings get/save; webhook events; audit
events; analytics; and provider sync. Include idempotency headers on every
administrator mutation.

Add the completed administration endpoint group to
`packages/contracts/src/api/endpoints.ts`.

- [ ] **Step 2: Replace weak dynamic records with discriminated schemas**

Define distinct schemas:

```ts
const AdminCreateSchema = z.discriminatedUnion("resource", [
  z.object({
    resource: z.literal("users"),
    email: z.string().email(),
    displayName: z.string().trim().min(1),
    password: z.string().min(12),
    roleIds: z.array(z.string().uuid()),
  }),
  z.object({
    resource: z.literal("domains"),
    name: z.string().trim().min(1),
  }),
  z.object({
    resource: z.literal("roles"),
    name: z.string().trim().min(1),
    description: z.string(),
    permissions: z.array(z.string()),
  }),
  z.object({
    resource: z.literal("provider-connections"),
    label: z.string().trim().min(1),
    apiKey: z.string().min(8),
    webhookSecret: z.string().min(8),
  }),
]);
```

Do the same for management operations. Do not retain
`Record<string, string>` form models.

- [ ] **Step 3: Write query normalization and invalidation tests**

Trim audit search before both key and request creation. Assert each mutation
invalidates the correct resource list/detail and cross-domain checkpoint data.

- [ ] **Step 4: Migrate Administration queries and forms**

Page components consume feature options and `useAppForm`. No URL, query key,
generic response type, or `apiRequest` call remains in `AdminPage.tsx`.

- [ ] **Step 5: Localize data display**

Translate navigation, actions, empty states, field labels, form copy, table
headers, enums, booleans, and accessible names. Column names use an explicit
typed translation map; never transform raw database field names into visible
English with `replaceAll`.

Dynamic email, IDs, keys, and codes use bidi isolation.

- [ ] **Step 6: Run tests**

Run:

```bash
pnpm --filter @unimailbox/contracts exec vitest run test/administration-endpoints.test.ts
pnpm --filter @unimailbox/web exec vitest run src/features/admin
pnpm --filter @unimailbox/web typecheck
pnpm --filter @unimailbox/web build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/contracts/src/api packages/contracts/test/administration-endpoints.test.ts apps/web/src/features/admin apps/web/src/i18n/resources
git commit -m "feat(admin): adopt typed localized administration"
```

---

### Task 10: Migrate Compose to TanStack Form without losing draft state

**Files:**

- Modify: `apps/web/src/features/mail/ComposePanel.tsx`
- Modify: `apps/web/src/features/mail/ComposePanel.test.tsx`
- Modify: `apps/web/src/i18n/resources/en/mail.json`
- Modify: `apps/web/src/i18n/resources/zh-CN/mail.json`
- Modify: `apps/web/src/i18n/resources/ar-XB/mail.json`

**Interfaces:**

- Produces: the final TanStack Form migration and Compose contract-backed
  validation.
- Consumes: the behavior baseline from Task 7 and the form composition proven
  by Tasks 5, 8, and 9.

- [ ] **Step 1: Re-run the locked Compose regression baseline**

Run:

```bash
pnpm --filter @unimailbox/web exec vitest run src/features/mail/ComposePanel.test.tsx
```

Expected: PASS before the form implementation changes.

- [ ] **Step 2: Add failing TanStack Form and translated-validation assertions**

Extend the test to prove:

- recipient entry uses TanStack field state;
- empty `to` produces the current locale's required-recipient error;
- invalid recipient produces the current locale's email error;
- submission cannot execute twice while pending;
- server draft, reply, and offline hydration still reset the intended fields;
- a locale change preserves recipients, subject, editor HTML, attachments,
  server draft ID, version, and parent message ID; and
- the page imports no React Hook Form API.

Run the focused test and verify the new assertions fail against the existing
React Hook Form implementation.

- [ ] **Step 3: Define display values and contract assembly**

Keep display-oriented recipient inputs:

```ts
interface ComposeFormValues {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
}
```

Convert recipient display strings through the existing normalized-address
function. Assemble editor HTML/text, parent message ID, signature flag, and
attachment IDs, then parse with `DraftMessageSchema` or `SendMessageSchema`.
Do not repeat their limits inside the component.

- [ ] **Step 4: Replace React Hook Form with `useAppForm`**

Replace `register`, full-form `watch`, `reset`, and `handleSubmit` with the
application TanStack Form composition. Use a narrow form-store subscription
for the 400 ms Dexie autosave. Keep editor and attachment state outside the
simple input fields.

Hydration precedence remains:

1. explicit server draft;
2. explicit reply context;
3. newest offline working draft only when neither explicit source exists.

- [ ] **Step 5: Preserve save/send concurrency and cache behavior**

Saving an existing draft sends its current ETag through `if-match`. Sending an
existing draft persists first, then sends with the saved version. Successful
send deletes the offline draft and invalidates both message and draft keys.
Pending submit disables duplicate send without blocking independent attachment
upload state.

- [ ] **Step 6: Run Compose, typecheck, build, and browser tests**

Run:

```bash
pnpm --filter @unimailbox/web exec vitest run src/features/mail/ComposePanel.test.tsx src/lib/form
pnpm --filter @unimailbox/web typecheck
pnpm --filter @unimailbox/web build
pnpm exec playwright test e2e/inbox.spec.ts e2e/setup.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/mail/ComposePanel.tsx apps/web/src/features/mail/ComposePanel.test.tsx apps/web/src/i18n/resources/en/mail.json apps/web/src/i18n/resources/zh-CN/mail.json apps/web/src/i18n/resources/ar-XB/mail.json
git commit -m "feat(mail): migrate compose form state"
```

---

### Task 11: Complete resource parity, locale formatting, RTL CSS, and bidi isolation

**Files:**

- Modify: `apps/web/src/i18n/format.ts`
- Modify: `apps/web/src/i18n/format.test.ts`
- Create: `apps/web/src/i18n/resources.test.ts`
- Modify: all files under `apps/web/src/i18n/resources/`
- Modify: `apps/web/src/styles.css`
- Modify: frontend TSX files containing directional icons or dynamic identifiers
- Create: `apps/web/src/components/BidiText.tsx`
- Create: `apps/web/src/components/BidiText.test.tsx`

**Interfaces:**

- Produces:
  - `formatDate(value, locale)`
  - `formatNumber(value, locale)`
  - `BidiText`
  - `.directional-icon`
- Consumes: complete resource sets from feature tasks.

- [ ] **Step 1: Write resource parity tests**

Recursively flatten resources and assert:

- `en` and `zh-CN` leaf-key sets are identical;
- interpolation variable sets are identical per key;
- no production value is empty;
- plural suffix sets are identical; and
- every `ErrorCode` has an `errors.api.<CODE>` translation.

- [ ] **Step 2: Write locale formatter tests**

Use fixed UTC timestamps and assert explicit English and Chinese output without
calling `Intl.DateTimeFormat(undefined)`. Test number, count/plural, byte-size,
and relative-date helpers used by the UI.

- [ ] **Step 3: Implement bidirectional text primitives**

```tsx
export function BidiText({
  children,
  kind = "auto",
}: {
  children: React.ReactNode;
  kind?: "auto" | "identifier";
}) {
  return kind === "identifier" ? (
    <bdi className="bidi-identifier" dir="ltr">
      {children}
    </bdi>
  ) : (
    <bdi dir="auto">{children}</bdi>
  );
}
```

Use identifier mode for emails, UUIDs, request IDs, codes, API keys, and paths.
Use auto mode for names and subjects.

- [ ] **Step 4: Convert physical CSS to logical CSS**

Replace all application layout uses of:

- `margin-left/right`
- `padding-left/right`
- positioned `left/right`
- `border-left/right`
- `text-align: left/right`
- `float: left/right`

with logical equivalents. Keep browser-normalization or third-party-content
exceptions only when a code comment explains why direction must remain
physical.

Add explicit `[dir="rtl"]` behavior for mobile sidebar and composer transforms
and shadows.

- [ ] **Step 5: Mark directional icons**

Apply `.directional-icon` only to back, next, reply, and comparable semantic
direction controls. Add:

```css
[dir="rtl"] .directional-icon {
  transform: scaleX(-1);
}
```

Do not apply the class to Star, Cloud, Lock, Spinner, formatting, or status
icons.

- [ ] **Step 6: Set email iframe and editor direction**

The message iframe receives explicit content direction derived from message
content policy, with `dir="auto"` for plain content when safe. Tiptap root
direction follows the active locale without reconstructing the editor.

- [ ] **Step 7: Run unit tests and static searches**

Run:

```bash
pnpm --filter @unimailbox/web exec vitest run src/i18n src/components/BidiText.test.tsx
rg -n "margin-(left|right)|padding-(left|right)|border-(left|right)|text-align:\\s*(left|right)|float:\\s*(left|right)" apps/web/src/styles.css
pnpm --filter @unimailbox/web typecheck
pnpm --filter @unimailbox/web build
```

Expected: tests/typecheck/build PASS; `rg` returns no unexplained application
layout matches.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/i18n apps/web/src/components apps/web/src/features apps/web/src/styles.css
git commit -m "feat(web): add direction-safe localized layout"
```

---

### Task 12: Add enforcement scripts, production-literal checks, and locale E2E matrix

**Files:**

- Create: `scripts/frontend-contract-check.mjs`
- Create: `scripts/frontend-contract-check.test.mjs`
- Create: `scripts/i18n-check.mjs`
- Create: `scripts/i18n-check.test.mjs`
- Modify: `package.json`
- Modify: `playwright.config.ts`
- Create: `e2e/fixtures/locale.ts`
- Modify: `e2e/login.spec.ts`
- Modify: `e2e/inbox.spec.ts`
- Modify: `e2e/setup.spec.ts`
- Modify: `e2e/setup-extras.spec.ts`
- Create: `e2e/rtl.spec.ts`
- Create: `e2e/preferences.spec.ts`

**Interfaces:**

- Produces:
  - `pnpm i18n:check`
  - `pnpm frontend:contracts`
  - Playwright projects `en`, `zh-CN`, `rtl-desktop`, `rtl-mobile`
- Consumes: completed frontend implementation.

- [ ] **Step 1: Write failing enforcement tests**

Fixtures must prove the scripts reject:

- unequal locale leaf keys;
- unequal interpolation variables;
- empty translation values;
- a production TSX visible string such as `<button>Save</button>`;
- `apiRequest<` in a production frontend file;
- a direct `error.message` render; and
- `useForm` imported from `react-hook-form`.

They must allow API paths, brand names, test data, technical identifiers, and
translation resource values.

- [ ] **Step 2: Implement exact enforcement commands**

Add root scripts:

```json
{
  "i18n:check": "node scripts/i18n-check.mjs",
  "frontend:contracts": "node scripts/frontend-contract-check.mjs"
}
```

The checks exit nonzero with file and line evidence.

- [ ] **Step 3: Configure Playwright projects**

Use Desktop Chrome for `en` and `zh-CN`, Desktop Chrome for `rtl-desktop`, and
Pixel 7 for `rtl-mobile`. Locale fixtures seed localStorage before navigation.
The RTL projects use `page.addInitScript` to seed
`localStorage["unimailbox.locale"] = "ar-XB"` before navigation. The locale
resolver accepts that value only because the Playwright web server is a Vite
development build; a production build rejects the same persisted value.

- [ ] **Step 4: Make functional E2E locale-aware**

Use role/accessibility selectors through a locale fixture. Keep at least one
literal English and one literal Chinese assertion for each critical flow:
login, Inbox, Compose, preferences, Settings, and Administration.

- [ ] **Step 5: Implement RTL E2E acceptance**

Assert:

```ts
await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
expect(
  await page.evaluate(
    () =>
      document.documentElement.scrollWidth <=
      document.documentElement.clientWidth,
  ),
).toBe(true);
```

Also assert sidebar inline-start position, composer inline-end position,
directional icon transforms, and readable email/UUID/request-ID text on desktop
and mobile.

- [ ] **Step 6: Run enforcement and E2E**

Run:

```bash
pnpm exec vitest run scripts/frontend-contract-check.test.mjs scripts/i18n-check.test.mjs
pnpm i18n:check
pnpm frontend:contracts
pnpm test:e2e
```

Expected: PASS for all four projects.

- [ ] **Step 7: Commit**

```bash
git add scripts package.json playwright.config.ts e2e
git commit -m "test(web): enforce locale and contract standards"
```

---

### Task 13: Remove compatibility layers and prove final frontend acceptance

**Files:**

- Modify or delete: `apps/web/src/lib/api.ts`
- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `docs/rules/frontend-platform.md`
- Modify: `docs/plans/frontend-platform-acceptance.md`
- Modify: `docs/development.md`
- Modify: `README.md`
- Test: all frontend, contract, Worker compatibility, and E2E suites

**Interfaces:**

- Produces: final accepted frontend with no legacy routing, forms, API calls, or untranslated UI.
- Consumes: Tasks 1–12.

- [ ] **Step 1: Run legacy-pattern searches**

Run:

```bash
rg -n "react-hook-form|apiRequest<|apiResponse\\(|from [\"'].*navigation[\"']|useLocation\\(\\).*pathname" apps/web/src
rg -n "error\\.message|attachments\\.reason|Intl\\.(DateTimeFormat|NumberFormat)\\(undefined" apps/web/src
rg -n ">[[:space:]]*[A-Za-z][^<{]*<|aria-label=[\"'][A-Za-z]|placeholder=[\"'][A-Za-z]" apps/web/src -g '*.tsx'
```

Expected: no production legacy matches. Any technical false positive must be
represented by a narrow rule exception with a reason; no user-visible copy
exception is allowed.

- [ ] **Step 2: Delete the compatibility APIs and React Hook Form**

Remove deprecated `apiRequest`, `apiResponse`, and `jsonBody` after the search
proves no call sites. Remove `react-hook-form` with:

```bash
pnpm --filter @unimailbox/web remove react-hook-form
```

Do not remove Zod or TanStack Query.

- [ ] **Step 3: Run the complete frontend acceptance document**

Execute every command and evidence check from
`docs/plans/frontend-platform-acceptance.md`. Record the date, exact command,
result, and any environment blocker in its evidence table. Never mark a blocked
check as passed.

- [ ] **Step 4: Run repository-wide final gates**

Run:

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

Expected: PASS.

- [ ] **Step 5: Perform final requirement-by-requirement audit**

Verify and document evidence for:

- complete English and Chinese UI;
- persistent language preference;
- `lang`, `dir`, title, and metadata;
- code-localized errors and request IDs;
- typed Router and guard semantics;
- canonical Query options and invalidation;
- complete endpoint contracts;
- complete TanStack Form migration;
- pseudo-RTL desktop/mobile behavior;
- Compose state preservation;
- absence of legacy patterns; and
- preservation of pre-existing user changes.

- [ ] **Step 6: Commit final cleanup**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/src/lib/api.ts docs/rules/frontend-platform.md docs/plans/frontend-platform-acceptance.md docs/development.md README.md
git commit -m "chore(web): complete frontend platform migration"
```

If `apps/web/src/lib/api.ts` is deleted, stage it with `git add -u` scoped to
that exact path.

---

## Task Review Protocol

Every implementation task receives two reviews before the next task starts:

1. **Specification review**
   - confirms the task implements every stated behavior and no unrelated scope;
   - compares current files and tests with this plan and the design spec.
2. **Code-quality review**
   - checks boundaries, type safety, security, i18n/RTL correctness, test
     quality, and preservation of user changes.

The implementing agent fixes findings and reruns focused verification before
the task is accepted. Because agents share this worktree and many tasks overlap
the same files, implementation agents run sequentially.

## Final Verification Summary

The frontend is not complete until these exact commands pass:

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

Passing a task-focused command proves only that task. It does not substitute
for the final requirement audit or the full command set.
