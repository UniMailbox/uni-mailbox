# Task 11 RTL and Localization Report

## Scope

Implemented exact resource parity enforcement, explicit locale formatting,
logical CSS layout, bidi text isolation, semantic icon mirroring, and explicit
direction handling for the mail iframe and existing Tiptap editor.

Implementation commit: `7f1a91c feat(web): add direction-safe localized layout`.

## RED evidence

Before implementation, the focused test command failed as expected:

- `BidiText.test.tsx` could not resolve `./BidiText` because the primitive did
  not exist.
- `format.test.ts` failed with `formatCount is not a function`.
- `resources.test.ts` reported resource-key drift (`ar-XB.settings` lacked
  `cloudflare.dashboardMode`) and missing stable error translations.

## GREEN verification

Passed:

- `pnpm --filter @unimailbox/web exec vitest run src/i18n src/components/BidiText.test.tsx src/components/Status.test.tsx src/features/mail/BidiMail.test.tsx src/features/mail/ComposePanel.test.tsx src/features/settings/CloudflareSettings.test.tsx`
  - 10 files, 45 tests.
- Logical-direction scan returned no matches:
  `rg -n "margin-(left|right)|padding-(left|right)|border-(left|right)|text-align:\\s*(left|right)|float:\\s*(left|right)" apps/web/src/styles.css`
- `pnpm --filter @unimailbox/web typecheck`
- `pnpm --filter @unimailbox/web build`
- `git diff --check`

## Direction policy

- `BidiText` uses `dir="auto"` for names and subjects, and isolated LTR for
  emails, IDs, request IDs, codes, paths, and other technical values.
- Only back, next, and reply controls receive `.directional-icon`; RTL mirrors
  only that class.
- The mail iframe declares `dir="auto"` because it does not inherit the
  application direction. The existing Tiptap editor updates its root direction
  from centralized locale metadata without being recreated.

## Concerns

- The build passed but Vite retained its existing chunk-size warning for the
  main bundle. No Task 11 dependency or chunking change was made.
- Desktop/mobile pseudo-RTL Playwright projects and their visual evidence are
  Task 12 work and were not added here.
