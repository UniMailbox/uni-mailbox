# Frontend Platform Modernization Design

Date: 2026-07-31

## Summary

UniMailbox will modernize its frontend platform before enforcing the same
contracts across the Worker. The frontend will gain:

- complete English and Simplified Chinese localization;
- a persistent language preference under Settings;
- direction-aware layout foundations for future RTL locales;
- TanStack Router for typed routing and route guards;
- TanStack Query conventions for remote state and cache invalidation;
- TanStack Form with shared Zod schemas;
- a contract-aware API client and feature service layer; and
- localized, code-driven error handling that never presents raw server messages
  as product copy.

The migration will be incremental. Existing authentication, permission, draft,
attachment, and mail behavior must remain available while individual frontend
areas move to the new platform.

The Worker-wide endpoint conversion is a later phase. During the frontend
phase, the new transport and client will remain compatible with the existing
`{ data }` and `{ error }` envelopes.

## Goals

- Support `en` and `zh-CN` on every frontend screen and allow an immediate
  language switch from `/settings/preferences`.
- Persist the selected locale in the browser and preserve it across reloads,
  login, and logout.
- Set `html.lang` and `html.dir` from centralized locale metadata.
- Make the layout, directional controls, and bidirectional content safe for a
  future RTL production locale.
- Replace custom history routing with typed TanStack Router routes, parameters,
  search validation, guards, pending states, error boundaries, and not-found
  handling.
- Make TanStack Query the sole owner of remote server state and centralize
  query keys, options, and mutation invalidation by domain.
- Migrate all frontend forms to TanStack Form and validate them with shared Zod
  schemas.
- Validate API requests and responses at runtime through endpoint contracts.
- Localize API and form errors from stable codes and safe parameters.
- Establish project rules and automated acceptance gates that prevent the old
  patterns from returning.

## Non-Goals

- Completing Worker-side request and response enforcement in the frontend
  phase.
- Adding an RTL production language in the first release.
- Synchronizing language preference to a user account or across devices.
- Upgrading React, TypeScript, Vite, Zod, Hono, or unrelated dependencies.
- Renaming existing API wire fields from snake case to camel case.
- Replacing Zustand for transient UI state or Dexie for offline working drafts.
- Refactoring Worker application services, repositories, or provider
  integrations.
- Adding TanStack Start or changing the Vite single-page application hosting
  model.

## Current State

The web application already uses React 18, TanStack Query, React Hook Form,
Zod, Zustand, Dexie, and Vite. TanStack Query calls are mostly embedded in
components. Query keys, response interfaces, paths, mutation invalidations,
and request construction are repeated across features.

Routing is implemented through:

- a custom `popstate` listener and history helpers in
  `apps/web/src/lib/navigation.tsx`;
- pathname parsing and component selection in `apps/web/src/App.tsx`; and
- component-level session and permission guards.

The contracts package contains several request schemas but does not describe a
complete endpoint. Most API responses are asserted by a caller-provided
generic without runtime validation. The Worker validates some bodies through
shared schemas, some through inline schemas, and some through manual checks.

The Worker error envelope usually contains `code`, `message`, optional
`details`, and `requestId`. The frontend discards `requestId` and some
components display `Error.message` or other server-provided text directly.

All visible product copy is currently English. The HTML language is fixed,
dates follow the browser rather than a selected application locale, and the
stylesheet includes physical left/right properties that do not adapt to RTL.

The worktree contains unrelated, uncommitted user changes, including current
authentication and session work. Implementation must preserve those changes
and establish their baseline before touching overlapping files.

## Target Architecture

The frontend will use the following one-way flow:

```text
Route or page
  -> feature query, mutation, or form options
  -> contract-aware API client
  -> shared endpoint contract
  -> existing Worker route
  -> application service
```

Responsibilities are separated as follows:

| Layer                | Responsibility                                                                                                                    |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts` | HTTP wire schemas, endpoint metadata, error codes, and safe error parameter schemas                                               |
| Router               | URL state, route parameters, search parameters, authentication and authorization entry guards, pending/error/not-found boundaries |
| TanStack Query       | Remote state, caching, retries, prefetching, invalidation, and server-state errors                                                |
| TanStack Form        | Form values, field state, validation lifecycle, reset, and submission state                                                       |
| Feature service      | Endpoint selection, DTO-to-view-model mapping, query/mutation options, and affected cache keys                                    |
| API transport        | Authentication headers, refresh, credentials, decoding, and request ID collection                                                 |
| Zustand              | Transient UI-only state such as composer visibility and intent                                                                    |
| Dexie                | Offline and browser-persistent working draft state                                                                                |
| i18next              | Product copy, validation text, error text, plurals, and locale selection                                                          |

The design deliberately avoids a generic `BaseService` or repository hierarchy
in the browser. Each feature exposes small, typed functions and option
factories that have one domain purpose.

## Proposed Frontend Structure

```text
apps/web/src/
  app/
    query-client.ts
    router.tsx
    router-context.ts
  routes/
    root.tsx
    public.tsx
    authenticated.tsx
    login.tsx
    inbox.tsx
    messages.tsx
    settings.tsx
    administration.tsx
  i18n/
    index.ts
    locale.ts
    format.ts
    errors.ts
    resources/
      en/
        common.json
        auth.json
        mail.json
        settings.json
        admin.json
        errors.json
      zh-CN/
        common.json
        auth.json
        mail.json
        settings.json
        admin.json
        errors.json
  lib/api/
    transport.ts
    client.ts
    errors.ts
  lib/form/
    app-form.tsx
    field-error.tsx
    validation.ts
  features/
    auth/api.ts
    mail/api.ts
    settings/api.ts
    admin/api.ts

packages/contracts/src/api/
  common/
    endpoint.ts
    envelope.ts
    errors.ts
    pagination.ts
  auth.ts
  mailboxes.ts
  messages.ts
  drafts.ts
  attachments.ts
  administration.ts
  endpoints.ts
  index.ts
```

The layer boundaries and responsibilities above are normative. Implementation
tasks may split a route or feature into smaller files, but must not move
transport, contract, routing, server-state, form, or localization
responsibilities across those boundaries.

## TanStack Router

### Initial route model

The first migration will use a code-based route tree. This avoids introducing
the Router Vite plugin, generated route files, and file-based routing at the
same time as authentication behavior is being moved. File-based routing may be
evaluated after the route model stabilizes.

The route tree includes:

- a root route with localized pending, error, and not-found boundaries;
- a public layout for login and the current register behavior;
- an authenticated layout;
- an administration layout nested under the authenticated layout;
- typed routes for mail folders, message details, settings sections, and
  administration resources; and
- a redirect from `/setup` to `/login`.

Unknown URLs will render a localized not-found page rather than silently
opening Inbox. This intentional behavior change will have explicit tests.

### Router context

The typed router context contains the Query Client and frontend service
dependencies needed by loaders and guards. React hooks are not called outside
React. Any hook-derived context is passed through the Router Provider.

### Authentication and authorization

The authenticated layout calls `ensureQueryData(sessionQueryOptions())` from
`beforeLoad`.

- A verified unauthenticated result or HTTP 401 redirects to `/login`.
- The redirect stores a validated, root-relative destination.
- Network failures, bootstrap failures, and 5xx responses go to an error
  boundary and must not be treated as logout.
- Administration routes assert their required permission in `beforeLoad`.
- Missing permission renders a 403 boundary and must not redirect to login.
- When a parent guard fails, child loaders and protected requests do not run.

The current open-redirect defenses remain mandatory: an accepted destination
starts with exactly one forward slash, is not an authentication route, and
contains no protocol-relative or backslash form.

### Router and Query integration

Loaders coordinate critical data but do not create a second cache. They use
shared Query options and `ensureQueryData` or prefetch APIs. Components read
the same Query cache. Only data required for the first meaningful render is
loaded at route level.

## TanStack Query Service Model

Every remote-state domain exposes:

- a query key factory;
- `queryOptions` or `infiniteQueryOptions`;
- typed mutation options or focused mutation hooks;
- an explicit list of affected keys for each mutation; and
- DTO-to-view-model mapping when a page should not consume wire shapes.

Query keys normalize semantically equivalent input before key construction.
For example, a trimmed audit search must not create a different key from the
trimmed value sent to the server.

Mutation invalidation is defined beside the domain operation. The migration
must explicitly cover:

- message folder changes and the affected detail and folder lists;
- sending a new message;
- sending an existing draft and removing it from draft caches;
- attachment completion;
- mailbox/member changes;
- Cloudflare configuration checkpoints and related domain data;
- provider connection changes; and
- administration create, update, and delete operations.

Global Query defaults remain conservative. Operation-specific retry behavior
is declared by the operation, especially for authentication and mutations.

## Endpoint Contracts and API Client

### Endpoint definition

Each endpoint used by the frontend declares:

```ts
{
  method,
  path,
  request: {
    params,
    query,
    headers,
    body,
  },
  responses: {
    200: schema,
    201: schema,
    204: null,
  },
  errors,
  mediaType,
}
```

The contract distinguishes `z.input` from `z.output`: the client accepts input
and the consuming service receives parsed output after defaults and
transformations.

Binary downloads, redirects, empty responses, idempotency headers, ETags, and
pagination cursors are explicit contract properties. They are not hidden
behind an untyped raw-response escape hatch.

### Transport

The transport owns:

- the `/api/v1` base path;
- access token headers;
- same-origin credentials;
- one refresh-and-retry attempt;
- content-type handling;
- JSON, non-JSON, and empty-body decoding;
- request ID collection from the body and response header; and
- conversion into the unified client error.

The client builds paths and queries from the endpoint definition, validates the
request before sending, and validates successful responses before returning.
Malformed success responses fail as client contract errors instead of
continuing into the UI.

### Compatibility

The frontend phase preserves the current API version, HTTP statuses, `{ data }`
success envelope, and `{ error }` error envelope.

- Existing `details` is accepted as a deprecated legacy field.
- New client logic prefers typed `params` when it becomes available.
- Missing body `requestId` falls back to `x-request-id`.
- Unknown legacy or provider codes map to `UNKNOWN_SERVER_ERROR` while
  retaining `rawCode` for diagnostics.
- Current snake-case response fields remain unchanged in the first contract
  schemas.
- The old `apiRequest` remains a temporary, documented migration escape hatch
  and is deleted only after all frontend endpoints have moved.

## Error Protocol and Localization

The frontend normalizes request failures into:

```ts
interface ApiError {
  code: ErrorCode | "UNKNOWN_SERVER_ERROR";
  rawCode?: string;
  status: number;
  params?: ErrorParams;
  requestId?: string;
  diagnosticMessage?: string;
}
```

Rules:

- `code` is the only business-branching and translation key.
- Known codes render `errors:api.<CODE>`.
- Unknown codes render a localized generic error.
- `diagnosticMessage` retains a safe server fallback for logs and debugging but
  is never rendered as normal product copy.
- `requestId` is retained and may be copied from an error UI.
- Internal causes, stack traces, SQL, provider payloads, tokens, and secrets
  are never surfaced.
- Raw storage reasons, message statuses, and field names are mapped through
  stable localized identifiers.

The later Worker phase will make the error-code registry append-only, map codes
to statuses centrally, type parameters per code, and enforce request ID
agreement between the body and header.

## TanStack Form and Validation

The frontend defines one `useAppForm` composition with standard field,
translated error, and submit components.

Shared Zod schemas express constraints without embedding English product copy.
The frontend validation adapter maps Zod issue codes, field paths, and safe
constraint values to translation keys.

Forms migrate individually while React Hook Form and TanStack Form coexist.
The order is:

1. simple Settings and Administration forms;
2. Login;
3. Cloudflare settings forms;
4. dynamic Administration forms after replacing weak
   `Record<string, string>` models with per-resource schemas; and
5. Compose.

Compose migrates last because it combines asynchronous server-draft and reply
hydration, form reset, Tiptap state, Dexie autosave, attachment state, and
optimistic version headers. Its acceptance tests must prove that form
migration and language switching do not lose any of those values.

React Hook Form is removed only after the last form and its regression tests
have migrated.

## Internationalization

### Supported locales

Production supports:

- `en`
- `zh-CN`

Development and test builds additionally support `ar-XB`, a pseudo RTL locale
used for layout verification. It does not appear in the production picker and
is not a valid production-persisted preference.

### Locale selection

Locale resolution is:

1. a valid value in `localStorage["unimailbox.locale"]`;
2. the first supported value from `navigator.languages`, with every Chinese
   variant normalized to `zh-CN`; or
3. `en`.

i18next initializes before React renders to avoid mixed-language first paint.
Language changes update:

- `document.documentElement.lang`;
- `document.documentElement.dir`;
- the persisted preference;
- document title and description metadata; and
- formatters that depend on the resolved locale.

The first release stores the preference locally. The locale service has a
storage boundary that can later be backed by an account preference without
changing pages.

### Settings

The route `/settings/preferences` contains a “Language & region” section. The
language selection applies immediately and has no save button. Because the
preference is local and resolved before authentication, it also applies to the
login screen.

### Resource organization

Namespaces are fixed:

- `common`
- `auth`
- `mail`
- `settings`
- `admin`
- `errors`

Keys use stable semantic identifiers, not English source text or component
positions. Sentences, resource labels, and plural forms are translated as
complete units rather than assembled from fragments.

All user-visible and accessible text is in scope, including:

- headings, labels, buttons, tabs, empty states, and status text;
- placeholders and editor placeholder content;
- `aria-label`, screen-reader-only content, iframe titles, and tooltips;
- document title and metadata;
- validation and API errors;
- dates, numbers, units, and plural forms; and
- API status and enum display names.

Product names, email addresses, domains, UUIDs, API keys, and configuration
paths are not translated.

## RTL and Bidirectional Content

Locale metadata is the only source of text direction. No component infers
direction from a locale string.

Physical CSS is replaced with logical properties:

- `margin-inline-start` and `margin-inline-end`;
- `padding-inline-start` and `padding-inline-end`;
- `inset-inline-start` and `inset-inline-end`;
- `border-inline-start`; and
- `text-align: start` and `text-align: end`.

Sidebar and composer closed/open transforms receive explicit RTL behavior.
The application never flips all SVG icons globally. Only semantic directional
icons receive a shared class or component behavior, including back, next, and
reply. Non-directional icons such as stars, clouds, locks, and spinners do not
flip.

Dynamic people names and subjects use `dir="auto"` or `bdi`. Email addresses,
UUIDs, codes, and paths use LTR isolation so they remain readable inside an RTL
sentence.

Email body iframes receive an explicit content-direction policy because they do
not inherit the parent document direction. Changing locale or direction must
not reconstruct the Tiptap editor or discard a working draft.

## Migration Plan

### Phase 0: Baseline

- Inspect and preserve all user changes.
- Stabilize the current authentication/session/permission work as a separate
  baseline before overlapping Router edits.
- Record typecheck, frontend test, build, and E2E results.
- Separate pre-existing failures from migration regressions.

### Phase 1: Foundations

- Add Router, Form, i18next, and react-i18next dependencies.
- Add locale metadata, initialization, resources, and isolated test helpers.
- Add Query Client factory and domain query-key conventions.
- Add the endpoint helper, transport, client, and normalized error.
- Keep current routes and pages running.

### Phase 2: Router

- Replace pathname dispatch with the code-based route tree.
- Move session and permission guards to `beforeLoad`.
- Add typed params and validated search.
- Add localized pending, error, forbidden, and not-found boundaries.
- Convert tests to memory history before deleting custom navigation tests.

### Phase 3: Query services and endpoint contracts

- Migrate auth, mailboxes, messages, drafts, attachments, settings, and
  administration in vertical domain slices.
- Add response validation and service mapping.
- Add explicit invalidation tests for each mutation.
- Add only critical route-level prefetching.

### Phase 4: Full localization

- Migrate common states and errors.
- Migrate authentication.
- Migrate mail list, message detail, and Compose.
- Add preferences and migrate Settings.
- Migrate Administration.
- Finish metadata, accessible names, enums, and locale formatting.

### Phase 5: Forms

- Add common form composition and validation translation.
- Migrate forms in the risk-ordered sequence.
- Remove React Hook Form only after Compose passes regression coverage.

### Phase 6: RTL and cleanup

- Convert remaining physical layout rules.
- Add direction-aware icon and panel behavior.
- Add pseudo-RTL test coverage.
- Delete custom navigation, bare API generics, scattered query keys, and the
  old form layer.
- Finalize rules, architecture documentation, and acceptance automation.

Each phase is independently reviewable and revertible. A later phase does not
start until the focused verification for the current phase passes or its
pre-existing blocker is explicitly recorded.

## Test Strategy

### Contract and client tests

- request and response positive and negative cases;
- compile-time rejection of incorrect paths, methods, bodies, and response
  assumptions;
- empty, JSON, non-JSON, binary, and redirect responses;
- refresh success, refresh failure, and exactly one retry;
- malformed success responses;
- known, unknown, and legacy errors;
- body/header request ID collection; and
- request schema transforms and defaults.

### Router tests

- public and protected routes;
- 401 versus 503/5xx behavior;
- permission denial versus authentication denial;
- prevention of child protected requests after guard failure;
- safe and unsafe post-login destinations;
- typed folder, message, settings, and administration parameters;
- pending, error, 403, and 404 boundaries; and
- browser back, forward, replace, and deep-link behavior.

### Query tests

- canonical query keys;
- query option reuse by components and loaders;
- mutation invalidation maps;
- no stale draft after send;
- no stale folder list after moving a message;
- no duplicate cache entries for normalized search; and
- error reset and retry behavior.

### Form tests

- translated validation issues;
- submission state and duplicate-submit prevention;
- server error mapping;
- reset after success;
- dynamic administration schemas;
- Cloudflare settings workflows; and
- Compose hydration, autosave, attachments, reply context, version headers,
  send, and language switching without data loss.

### Internationalization tests

- locale resolution precedence and normalization;
- invalid persisted values;
- synchronized `lang`, `dir`, title, metadata, and local storage;
- exact key and interpolation parity between English and Chinese;
- plurals, dates, numbers, and units;
- known and unknown API errors;
- all enum display mappings; and
- editor placeholder refresh without editor destruction.

### Browser tests

Playwright provides:

- English and Chinese functional projects covering login, Inbox, message
  detail, Compose, language preference, persistence, Settings, and an
  authorized Administration route;
- pseudo-RTL desktop and mobile projects;
- horizontal-overflow assertions;
- sidebar and composer inline-position assertions;
- directional-icon assertions; and
- bidirectional email, UUID, and error-code readability.

Selectors prefer roles and accessible names through locale-aware helpers.
Selected literal assertions remain in each production locale so broken
translation resources cannot make both the UI and test drift together.

## Acceptance Criteria

The frontend is complete only when all of the following are true:

- Every production screen is usable in English and Simplified Chinese.
- Switching language is immediate and persists across reload, login, and
  logout.
- The HTML language, direction, title, and description reflect the active
  locale.
- Production TSX contains no user-visible English literals outside deliberate
  brand names, technical identifiers, addresses, IDs, codes, and paths.
- The UI never directly renders server `message`, storage `reason`, or raw
  status enums.
- Known API errors are localized by code; unknown errors show a localized
  fallback and retain the request ID.
- Custom history routing is removed.
- Authentication and permission behavior matches the guarded contract.
- All remote data uses domain Query options and canonical keys.
- Every frontend API operation has an endpoint contract; no temporary
  uncontracted operation remains at final acceptance.
- Every form uses TanStack Form and a shared or contract-backed Zod schema.
- React Hook Form is removed.
- RTL desktop and mobile layouts have no horizontal overflow and preserve
  bidirectional identifiers.
- Compose does not lose content, recipients, attachments, reply context,
  working-draft state, or version state during locale changes or form
  migration.
- User changes that existed before implementation remain intact.

Required final commands:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm audit --prod
git diff --check
```

Passing a narrower test is evidence only for that slice. It is not sufficient
to claim full frontend completion.

## Project Rules Produced by This Work

The implementation will add focused rule documents under `.rules/` that
cover:

- frontend architecture and state ownership;
- TanStack Router and Query conventions;
- endpoint contract and error handling conventions;
- form and validation conventions;
- localization key, copy, formatting, and accessibility conventions;
- RTL and bidirectional-layout conventions; and
- mandatory frontend verification and exception handling.

Rules will include prohibited patterns, approved alternatives, and CI or review
evidence. They will not be aspirational prose without an enforcement path.

## Risks and Mitigations

### Dirty worktree and overlapping authentication changes

Mitigation: establish an explicit baseline and stage only task-owned files.
Never reset or overwrite unrelated work.

### Authentication semantics change during Router migration

Mitigation: pin 401, 503/5xx, permission, child-query, redirect, and browser
history behavior in tests before removing the old implementation.

### Contract schemas expose existing response drift

Mitigation: model current wire shapes first, add conformance tests, and defer
field-renaming changes.

### Stale Query caches after mutations

Mitigation: make affected keys part of every mutation definition and test each
invalidation map.

### Form migration loses complex Compose state

Mitigation: migrate Compose last and require focused unit and browser
regression coverage for every state source.

### Missing translations hidden by fallback

Mitigation: enforce exact resource parity and include literal locale assertions
in E2E.

### Superficial RTL support

Mitigation: use pseudo-RTL desktop/mobile projects, overflow assertions,
directional component checks, and bidirectional test content.

## Later Worker Phase

After the frontend phase is accepted, the Worker can consume the same endpoint
contracts to:

- validate every path, query, header, and body;
- validate every response;
- centralize the append-only error-code registry;
- map error codes to HTTP statuses;
- emit typed, safe parameters;
- ensure body and header request IDs agree;
- normalize malformed JSON and validation errors; and
- remove the frontend compatibility handling for legacy `details`.

That later work completes the original front-to-back contract goal without
blocking the frontend modernization.
