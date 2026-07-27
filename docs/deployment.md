# Deployment Guide

This project deploys two Cloudflare surfaces:

- `apps/api`: Worker API with D1, KV, and R2 bindings.
- `apps/web`: React app deployed to Cloudflare Pages.

## Cloudflare Resources

Create the resources once:

```bash
pnpm --filter @cf-startup/api exec wrangler d1 create cf-startup-db
pnpm --filter @cf-startup/api exec wrangler kv namespace create APP_KV
pnpm --filter @cf-startup/api exec wrangler r2 bucket create cf-startup-files
```

Copy the generated ids into `apps/api/wrangler.toml`:

- `database_id` for the `DB` D1 binding.
- `id` for the `APP_KV` namespace.
- `bucket_name` for `FILE_BUCKET` if you changed the default bucket name.

Apply the initial D1 migration:

```bash
pnpm --filter @cf-startup/api exec wrangler d1 migrations apply cf-startup-db --local --config wrangler.toml
pnpm --filter @cf-startup/api exec wrangler d1 migrations apply cf-startup-db --remote --config wrangler.toml
```

## GitHub Settings

Add these repository secrets:

- `CLOUDFLARE_API_TOKEN`: Cloudflare API token with permission to deploy Workers, deploy Pages, and apply D1 migrations.
- `CLOUDFLARE_ACCOUNT_ID`: Cloudflare account id.

Add this repository variable:

- `CLOUDFLARE_PAGES_PROJECT_NAME`: Cloudflare Pages project name for the frontend.
- `VITE_API_BASE_URL`: public Worker API URL baked into the frontend build.

The workflow is defined in `.github/workflows/deploy.yml`.

## Deploy Behavior

On pushes to `main` or `master`, GitHub Actions will:

1. Install dependencies with `pnpm install --frozen-lockfile`.
2. Run `pnpm typecheck`.
3. Run `pnpm test`.
4. Run `pnpm build`.
5. Run `pnpm audit --prod`.
6. Apply remote D1 migrations.
7. Deploy the Worker API.
8. Deploy the Pages frontend.

Manual runs can skip API deploy, D1 migrations, or web deploy through workflow inputs.

## Frontend Runtime API URL

For production Pages builds, set:

```bash
VITE_API_BASE_URL=https://your-worker.your-subdomain.workers.dev
```

The app also includes an initial setup panel that stores a local browser override for the API base URL. That override is useful while wiring environments, but production deployments should still set `VITE_API_BASE_URL` through Pages environment variables.
