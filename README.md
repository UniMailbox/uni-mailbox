# Cloudflare Full-Stack Starter

Basic framework for a Cloudflare-native app:

- **Backend**: Cloudflare Worker, TypeScript, Hono, D1 migrations, KV, R2, RBAC.
- **Frontend**: Cloudflare Pages, React, Vite, shared RBAC contract.
- **Shared**: roles, permissions, and API response types in `packages/shared`.

## Structure

```txt
apps/
  api/        Worker API using Hono
  web/        React app deployed with Cloudflare Pages
packages/
  shared/     RBAC and DTO types shared by API and web
```

## Install

```bash
npm install
```

Copy the example environment file if you want to override the local API URL:

```bash
cp .env.example .env
```

## Local Development

Run the API:

```bash
npm run dev:api
```

Run the web app:

```bash
npm run dev:web
```

The web app defaults to `http://127.0.0.1:8787` for API calls. Override with:

```bash
VITE_API_BASE_URL=http://127.0.0.1:8787 npm run dev:web
```

## D1 Setup

Create a D1 database and replace the placeholder database id in `apps/api/wrangler.toml`.

```bash
npx wrangler d1 create cf-startup-db
npx wrangler d1 migrations apply cf-startup-db --local --config apps/api/wrangler.toml
npx wrangler d1 migrations apply cf-startup-db --remote --config apps/api/wrangler.toml
```

## KV and R2 Setup

Create Cloudflare resources and replace placeholder ids/names in `apps/api/wrangler.toml`.

```bash
npx wrangler kv namespace create APP_KV
npx wrangler r2 bucket create cf-startup-files
```

## RBAC

This starter uses a development-friendly header identity:

- `x-user-id`: user id, defaults to `anonymous`
- `x-user-role`: `viewer`, `editor`, or `admin`

Replace `src/auth.ts` with real authentication before production. Authorization checks are already centralized through shared permissions.

## Initial Setup UI

The React app includes an initial setup panel for wiring the first deployment. It tracks:

- Worker API URL used by frontend requests.
- Cloudflare Pages project name.
- D1 database name.
- KV namespace id.
- R2 bucket name.
- Setup checklist progress.

The panel stores only non-sensitive local setup state in the browser. Cloudflare API tokens must stay in GitHub Secrets or Cloudflare-managed configuration.

## Deployment

Deployment automation lives in `.github/workflows/deploy.yml`.

Required GitHub repository secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Required GitHub repository variable:

- `CLOUDFLARE_PAGES_PROJECT_NAME`
- `VITE_API_BASE_URL`

See `docs/deployment.md` for the full deployment checklist and workflow behavior.
