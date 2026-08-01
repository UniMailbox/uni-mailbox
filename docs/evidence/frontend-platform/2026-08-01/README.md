# Frontend Platform Manual Acceptance Evidence

## Scope and method

These screenshots were captured against the current Vite build at
`http://127.0.0.1:5189` with contract-shaped mocked responses. The controller
used `agent-browser` to exercise the stated workflow and visually inspected
each screenshot. They are manual/browser evidence, not static-code claims.

The automated complement is the clean-server Playwright matrix recorded in the
acceptance plan: 46/46 tests passed with one worker (20 `en`, 20 `zh-CN`, 3
`rtl-desktop`, and 3 `rtl-mobile`). This includes EN and Chinese browser cases
for preference persistence through actual logout/login, account-email
submission, localized not-found, and localized forbidden boundaries.

## Evidence map

| Acceptance row                    | Screenshot(s)                                                                                          | Viewport / locale | Observed result                                                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Login long copy and validation    | [zh-login-desktop.png](zh-login-desktop.png)                                                           | 1440x1000 / zh-CN | Long Chinese login and validation copy fits without clipping.                                                                |
| Inbox dense list                  | [zh-inbox-dense-desktop.png](zh-inbox-dense-desktop.png)                                               | 1440x1149 / zh-CN | Ten dense inbox rows and formatted unread count `1,284` remain readable without clipping.                                    |
| Compose recipients/editor/actions | [zh-compose-desktop.png](zh-compose-desktop.png)                                                       | 1440x1149 / zh-CN | Recipient `team@example.com`, Chinese subject/body, editor, and actions are simultaneously visible.                          |
| Settings tabs and preference      | [zh-settings-preference-mobile.png](zh-settings-preference-mobile.png)                                 | 390x844 / zh-CN   | Tabs and the zh-CN language selector remain visible and usable at the mobile viewport.                                       |
| Admin navigation/table/forms      | [zh-admin-desktop.png](zh-admin-desktop.png)                                                           | 1440x1000 / zh-CN | Localized navigation/table and the expanded create form are visible without overlap.                                         |
| Sidebar/composer                  | [rtl-sidebar-desktop.png](rtl-sidebar-desktop.png), [rtl-compose-desktop.png](rtl-compose-desktop.png) | 1440x1146 / ar-XB | Sidebar is at inline-start, composer at inline-end, and there is no horizontal overflow.                                     |
| Sidebar/composer                  | [rtl-sidebar-mobile.png](rtl-sidebar-mobile.png), [rtl-compose-mobile.png](rtl-compose-mobile.png)     | 390x844 / ar-XB   | Open sidebar geometry is `x=120`, `width=270`; composer is `x=0`, `width=390`; `scrollWidth - clientWidth = 0`.              |
| Mixed email/UUID/error text       | [rtl-mixed-email-uuid-error-mobile.png](rtl-mixed-email-uuid-error-mobile.png)                         | 390x844 / ar-XB   | `ops@example.com` and request ID `33333333-3333-4333-8333-333333333333` are readable; the error card stays within x=14..376. |
| Keyboard focus order              | [en-login-focus-order.png](en-login-focus-order.png)                                                   | 1280x633 / en     | Tab order: wordmark link → email input → password input → submit button; each focused control has a visible focus ring.      |
| Keyboard focus order              | [rtl-login-focus-order.png](rtl-login-focus-order.png)                                                 | 1440x1000 / ar-XB | The same Tab sequence is preserved in RTL; email remains `dir=ltr` and focus is visible.                                     |

## Keyboard sequence

Both login screenshots were captured after keyboard-only navigation. From the
initial document focus, press `Tab` four times and observe: wordmark link,
email input, password input, then submit button. No pointer action is needed
to reach those controls. The executable counterpart is
`e2e/login.spec.ts` for EN/zh-CN and `e2e/rtl.spec.ts` for both RTL projects;
each presses `Tab` from `body`, verifies the active element and
`:focus-visible` state at every step, and verifies the RTL email input remains
`dir=ltr`.
