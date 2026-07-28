# Setup recovery

Setup state is server-owned and resumable. Do not change D1 rows manually during
normal recovery.

1. Open `/api/v1/setup/status` and record `currentStep`, `stateVersion`, and any
   recoverable error.
2. Run `pnpm scaffold doctor`, `pnpm db:verify --target production`, and check
   `/health`.
3. Reopen `/setup` in the browser holding the short-lived setup session. If it
   expired before the first administrator was created, claim again with the
   installation token.
4. Re-run only the current checkpoint. A checkpoint advances only after its
   server-side verification passes.
5. For Cloudflare dashboard-assisted setup, verify DNS and Email Routing
   configuration and then prove it with a newly generated inbound token.
6. For Brevo, rotate the connection secret in the control plane and repeat the
   outbound smoke test.
7. After installation, open a time-limited administrator repair session before
   changing setup state. Never re-enable the original installation token.

If state cannot advance, retain the request ID and structured event log. Fix
forward; do not reset or delete an installed production database.
