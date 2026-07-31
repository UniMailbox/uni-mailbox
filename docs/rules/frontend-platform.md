# Frontend Platform Rules

These rules apply to production code under `apps/web`, HTTP contracts consumed
by the frontend under `packages/contracts/src/api`, frontend tests, and the
frontend Playwright suite.

They supplement the repository-wide rules in `docs/rules/README.md`.

## 1. Dependency and Scope Rules

- Use pnpm from the repository root or an explicit workspace filter.
- Keep React at 18.3.x, TypeScript at 5.6.x, Vite at 5.4.x, and Zod at 3.25.x
  during the frontend modernization.
- Do not introduce TanStack Start, a second router, a second remote-state
  library, or a second validation library.
- Do not change Worker business behavior, API version, or wire-field casing as
  part of a frontend migration task.
- Preserve all pre-existing worktree changes. Before editing an overlapping
  file, inspect its current diff.
- Stage only task-owned files. Never use a broad `git add .` for this work.

Enforcement:

- dependency review of `apps/web/package.json` and `pnpm-lock.yaml`;
- `git diff --cached --name-only` before each commit;
- full typecheck, test, and build gates.

## 2. State Ownership

Each state value must have exactly one owner:

| State | Owner |
| --- | --- |
| Path, params, search, navigation, route guard result | TanStack Router |
| Remote records, loading, retries, cache, server errors | TanStack Query |
| Field values, field errors, submit/reset lifecycle | TanStack Form |
| Product copy, locale, plurals, formatting locale | i18next |
| Composer visibility and transient UI intent | Zustand |
| Offline working drafts | Dexie |
| HTTP method/path/request/response/error shape | `@unimailbox/contracts` |

Prohibited:

- copying Query data into Zustand or component state without a documented
  editing or snapshot requirement;
- putting route state into Zustand;
- using Query cache for transient modal state;
- adding another global store for locale or session;
- making Dexie the source of truth for server records.

## 3. Router Rules

- Use TanStack Router links, navigation, params, and search APIs.
- Define application routes in the shared typed route tree.
- Validate external search input with Zod or an equally typed route validator.
- Put authentication in the authenticated parent route `beforeLoad`.
- Put administration permission checks in administration route guards.
- A 401 redirects to login with `replace: true`.
- A 403 renders the forbidden boundary and does not redirect to login.
- A 503 or 5xx renders an error boundary and does not clear a valid session.
- A failed parent guard must prevent child loaders and protected requests.
- Unknown paths render the localized not-found boundary.
- Preserve safe post-login redirect validation:
  - exactly one leading `/`;
  - no `//`;
  - no backslash form;
  - no absolute URL;
  - no login or register destination.

Prohibited:

- direct `window.history.pushState` or `replaceState` in production features;
- production `popstate` listeners for application navigation;
- parsing `window.location.pathname` to select a page;
- component effects that redirect solely because a route guard was omitted;
- treating every session-query failure as unauthenticated.

Required evidence:

- memory-history unit tests;
- browser deep-link, back, forward, and redirect E2E;
- explicit 401/403/503/5xx tests.

## 4. TanStack Query Rules

- Every remote read uses a feature-owned `queryOptions` or
  `infiniteQueryOptions`.
- Every query key comes from a feature-owned key factory.
- Normalize search, filters, and identifiers before both key construction and
  request construction.
- Query options are reusable by components, Router loaders, prefetch, and
  tests.
- Every mutation declares and tests its affected cache keys.
- Use operation-specific retry policy for authentication and mutations.
- Router loaders coordinate Query data; they do not create a second cache.
- Map wire DTOs to view models in the feature service when the UI should not
  depend on transport naming or encoding.

Prohibited:

- inline `queryKey` arrays in page components;
- raw URL construction inside components;
- duplicate local interfaces that describe an endpoint response;
- broad `invalidateQueries()` without an intentional key scope;
- cache keys built from unnormalized values;
- copying Query loading/error state into component state.

Required evidence:

- key-factory unit tests;
- invalidation tests for every mutation;
- no duplicate-cache regression for normalized input;
- error reset/retry tests.

## 5. Endpoint Contract Rules

Every frontend API operation must declare:

- HTTP method;
- path template;
- params schema when applicable;
- query schema when applicable;
- header schema when applicable;
- body schema when applicable;
- every accepted success status and response schema;
- allowed error codes;
- media type: JSON, empty, binary, or redirect.

Additional rules:

- Use `z.input` for caller input and `z.output` for parsed output.
- Preserve current wire casing during the frontend phase.
- Validate successful responses at runtime.
- Treat malformed success bodies as `CLIENT_RESPONSE_INVALID`.
- Model ETag, idempotency, pagination, binary download, redirect, and 204
  semantics explicitly.
- Internal domain/event models with `Date`, `ArrayBuffer`, or provider adapters
  are not HTTP wire DTOs.
- Temporary compatibility accepts legacy `details`; new behavior prefers typed
  `params`.

Prohibited:

- `apiRequest<T>(string)` after final migration;
- caller-provided response generics without runtime schema validation;
- raw `Response` escape hatches for a normal endpoint;
- Hono route implementation types as the public frontend contract;
- using `unknown` as a permanent administration response shape;
- renaming wire fields while first introducing their schema.

Enforcement:

- `pnpm frontend:contracts`;
- positive/negative schema tests;
- compile-time failure cases;
- final source scan for legacy API calls.

## 6. Error Rules

- Machine behavior branches only on stable error code and HTTP status.
- User-visible error text comes from `errors:api.<CODE>`.
- Unknown codes use a localized generic message.
- Preserve `rawCode` only for diagnostics.
- Preserve request ID from the body or `x-request-id`.
- Show request ID in a copyable, bidi-isolated form when available.
- Treat server `message` as `diagnosticMessage`, never as normal product copy.
- Error parameters must be JSON-safe, secret-free, and limited to values
  required for safe interpolation or action.

Prohibited:

- rendering `error.message`;
- rendering storage `reason`;
- rendering provider error text;
- interpolating a stack trace, SQL, token, secret, credential, or provider
  payload;
- branching on a localized string;
- inventing a server request ID when none was supplied.

Required evidence:

- known-code localization test in both production locales;
- unknown-code fallback test;
- request-ID body/header tests;
- non-JSON and malformed-success tests.

## 7. Form and Validation Rules

- Use the application TanStack Form composition.
- Use a shared request schema or a form schema derived from the request
  contract.
- Shared Zod schemas do not contain localized English product sentences.
- Translate validation from stable issue code, field path, and safe numeric
  constraint values.
- Disable duplicate submit from `canSubmit` and `isSubmitting`.
- Keep server error rendering separate from field validation.
- Test success reset, async hydration, and server errors.
- Dynamic administration forms use discriminated schemas rather than
  `Record<string, string>`.
- Compose keeps Tiptap editor state separate from simple input field state and
  parses the assembled contract input at submit/save.

Prohibited:

- React Hook Form after final migration;
- duplicate min/max/email constraints in page code;
- English strings inside shared Zod schemas;
- one untyped dynamic form for unrelated resource shapes;
- recreating the editor to update locale;
- clearing hydrated or offline draft data during locale change.

Required evidence:

- field validation tests in English and Chinese;
- duplicate-submit test;
- reset/hydration tests;
- Compose state preservation suite.

## 8. Localization Rules

Production locales:

- `en`
- `zh-CN`

Test/development-only locale:

- `ar-XB`

Namespaces are fixed:

- `common`
- `auth`
- `mail`
- `settings`
- `admin`
- `errors`

Key rules:

- Use semantic keys such as `mail:folders.inbox`.
- Do not use English source text as a key.
- Do not encode component position in a key.
- Do not repeat a namespace prefix inside its own resource.
- Translate complete sentences and complete UI units.
- Use i18next interpolation and plural forms.
- Keep English and Chinese leaf keys, interpolation variables, and plural
  suffixes identical.
- Do not rely on fallback language to hide a missing production key.

All of the following are product copy:

- visible text;
- headings, labels, actions, tabs, and empty states;
- validation and API errors;
- placeholders and editor placeholder text;
- `aria-label`, screen-reader-only text, tooltip, and iframe title;
- document title and description;
- status and enum labels;
- dates, numbers, units, and plural forms.

Deliberately untranslated:

- UniMailbox product name;
- email addresses and domains;
- UUIDs and request IDs;
- API keys and provider identifiers;
- error codes;
- URLs and configuration paths.

Prohibited:

- visible English literals in production TSX outside deliberate technical or
  brand identifiers;
- concatenated translated sentence fragments;
- raw enum/status display;
- `Intl.DateTimeFormat(undefined)` or `Intl.NumberFormat(undefined)`;
- a production language picker containing `ar-XB`;
- a global i18n instance shared across parallel unit tests.

Enforcement:

- `pnpm i18n:check`;
- isolated test instances;
- English and Chinese E2E with selected literal assertions.

## 9. Locale Preference Rules

Resolution order:

1. valid `localStorage["unimailbox.locale"]`;
2. supported browser language, with every Chinese variant normalized to
   `zh-CN`;
3. `en`.

On language change:

- update `html.lang`;
- update `html.dir` from locale metadata;
- update document title and description;
- persist production locale;
- refresh locale-aware formatters;
- keep Router, Query cache, Form values, editor state, and drafts intact.

The settings route is `/settings/preferences`. Selection applies immediately
without a Save button.

Prohibited:

- inferring text direction inside individual components;
- storing `ar-XB` as a production preference;
- requiring authentication before applying the saved locale;
- reloading the application to apply a language.

## 10. RTL and Bidirectional Rules

- Use logical CSS properties for application layout.
- Use `text-align: start/end`.
- Add explicit RTL transform behavior for off-canvas sidebar and composer.
- Flip only icons whose semantic direction changes.
- Use `dir="auto"` or `bdi` for names and subjects.
- Use `dir="ltr"` plus bidi isolation for email, UUID, request ID, code, key,
  URL, and path.
- Set an explicit direction policy on email body iframe content.
- Test desktop and mobile RTL with pseudo-localized content.

Prohibited:

- global SVG mirroring;
- unexplained physical `left`, `right`, `margin-left/right`,
  `padding-left/right`, `border-left/right`, `float`, or physical text
  alignment in application layout;
- assuming the email iframe inherits the parent direction;
- using RTL-only visual inspection without overflow and position assertions.

Required evidence:

- `html[dir=rtl]`;
- `scrollWidth <= clientWidth`;
- sidebar inline-start assertion;
- composer inline-end assertion;
- directional and non-directional icon assertions;
- readable mixed-direction identifiers.

## 11. Accessibility Rules

- Prefer native elements and accessible roles.
- Localize accessible names as carefully as visible names.
- Keep error cards at `role="alert"`, loading states at `role="status"` with
  `aria-live="polite"`, and success notes at `role="status"`.
- Every form control has an associated localized label.
- Directional icons are decorative when the control has a text or ARIA name.
- Locale E2E selectors prefer roles and accessible names.
- Do not add `data-testid` when a stable accessible query is available.

## 12. Testing and Verification Rules

Every task:

1. writes or establishes the failing behavior test;
2. runs it and records the expected failure;
3. implements the narrow behavior;
4. reruns the focused test;
5. runs frontend typecheck;
6. runs the affected browser workflow when behavior crosses a browser
   boundary; and
7. inspects staged paths before committing.

Final commands:

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

Never report a skipped, blocked, unavailable, or narrower check as passing.

## 13. Exceptions

An exception must:

- name the exact file and line/pattern;
- explain why the approved pattern cannot be used;
- state the narrowest scope and removal condition;
- include a test that protects the intended behavior; and
- be approved during review.

Exceptions may not permit:

- user-visible untranslated English;
- raw server messages;
- unvalidated successful API responses;
- an open redirect;
- lost Compose state;
- broad physical RTL layout;
- a second source of truth for remote data; or
- a final uncontracted frontend endpoint.
