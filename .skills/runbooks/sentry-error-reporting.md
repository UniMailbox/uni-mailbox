# Sentry error reporting

UniMailbox can report unexpected browser and Worker failures to separate Sentry projects. Both integrations are disabled when their DSN is absent. Error sampling defaults to `1`; performance tracing defaults to `0`.

## Browser configuration

Copy `apps/web/.env.example` to the environment used for the Vite build and set:

- `VITE_SENTRY_DSN`: the browser project's public DSN.
- `VITE_SENTRY_ENVIRONMENT`: for example `production` or `preview`.
- `VITE_SENTRY_RELEASE`: the immutable release or commit identifier.
- `VITE_SENTRY_SAMPLE_RATE`: error sample rate from `0` to `1`.
- `VITE_SENTRY_TRACES_SAMPLE_RATE`: trace sample rate from `0` to `1`.

For readable production stack traces, also provide `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, and `SENTRY_PROJECT` only to the build environment. The Vite plugin then uploads hidden source maps and removes them from `dist`. These three values are never exposed through `import.meta.env`. `SENTRY_RELEASE` may be supplied to give the upload the same release identifier as `VITE_SENTRY_RELEASE`.

The browser captures unhandled exceptions, route errors, unexpected query errors, and unexpected mutation errors. Expected permission and other 4xx API responses are not reported.

## Worker configuration

Store the Worker DSN as a secret; do not add it to `wrangler.jsonc`:

```sh
pnpm exec wrangler secret put SENTRY_DSN
pnpm exec wrangler secret put SENTRY_DSN --env preview
```

`wrangler.jsonc` defines environment names and conservative sampling defaults. `SENTRY_RELEASE` is optional because the Worker falls back to `CF_VERSION_METADATA.tag`. Local development can set an optional `SENTRY_DSN` in `.dev.vars`; leaving it empty keeps reporting disabled.

The Worker wrapper covers fetch, email, scheduled, and queue entrypoints. Handled HTTP 5xx failures and caught queue failures are reported explicitly; expected domain 4xx failures are skipped.

## Data handling

Both integrations set `sendDefaultPii: false`. Their `beforeSend` hooks remove request bodies, cookies, query strings, email addresses, credentials, message content, mailbox and message identifiers, and other sensitive mail fields. HTTP route tags normalize UUID path segments, and queue reports never include the job payload.

## Verification

Unit tests cover disabled-by-default behavior, sample-rate bounds, PII scrubbing, expected-error filtering, HTTP route normalization, and queue capture. A live delivery check still requires configured Sentry projects:

1. Deploy a preview release with both DSNs and a unique release identifier.
2. Trigger a synthetic unexpected browser error and a synthetic Worker 500 in the preview environment.
3. Confirm both issues appear under the expected environment and release, with readable stack traces and no request body, cookies, query string, email address, or message content.
4. Remove the synthetic failure and redeploy.
