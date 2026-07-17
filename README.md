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
