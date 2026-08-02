# UniMailbox Greenfield Technical Specification

## 1. Objective

Build a serverless email application that supports:

- User registration and authentication
- Managed email domains
- Personal and shared mailboxes
- Inbound email through Cloudflare Email Routing
- Outbound email through Brevo in the first release
- Inbox, sent mail, drafts, stars, replies, CC, and BCC
- Domain-level signatures
- Direct attachment upload to R2
- Provider webhooks and message-status synchronization
- Role-based administration
- Auditable background processing

The implementation must favor explicit contracts, typed boundaries,
idempotent operations, and feature-owned modules. Brevo and Resend are the
built-in outbound providers, and provider-neutral application contracts must
allow another adapter to be added without changing message business logic or
core tables.

## 2. Technology stack

| Layer                 | Technology                                                |
| --------------------- | --------------------------------------------------------- |
| Runtime               | Cloudflare Workers                                        |
| HTTP framework        | Hono                                                      |
| Language              | TypeScript                                                |
| Database              | Cloudflare D1                                             |
| ORM/query builder     | Drizzle ORM                                               |
| Object storage        | Cloudflare KV (default), Cloudflare R2 (optional overlay) |
| Cache and rate limits | Cloudflare KV                                             |
| Async processing      | Cloudflare Queues                                         |
| Inbound MIME parser   | PostalMime                                                |
| Web client            | React, Vite, TypeScript                                   |
| Client state          | TanStack Query for server state, Zustand for UI state     |
| Forms and validation  | React Hook Form and Zod                                   |
| Local drafts          | Dexie                                                     |
| Rich-text editor      | Tiptap                                                    |
| Unit and Worker tests | Vitest and Cloudflare Workers test pool                   |
| Browser tests         | Playwright                                                |

## 3. System architecture

```text
Browser
  ├── HTTPS API ─────────────────────────────┐
  ├── Direct attachment PUT ────────┐        │
  └── Static assets                 │        │
                                    ▼        ▼
                       Cloudflare KV / R2   Worker HTTP entrypoint
                                                │
Cloudflare Email Routing ──> Worker email entrypoint
                                                │
Cloudflare Cron ───────────> Worker scheduled entrypoint
                                                │
Cloudflare Queue ──────────> Worker queue consumer
                                                │
                         ┌──────────────────────┼──────────────────────┐
                         ▼                      ▼                      ▼
                    Cloudflare D1         Cloudflare KV        Provider adapters
                                                                  └── Brevo
```

### 3.1 Runtime entrypoints

The Worker exposes four independent entrypoints:

```typescript
export default {
  fetch: handleHttpRequest,
  email: handleInboundEmail,
  scheduled: handleScheduledTask,
  queue: handleQueueBatch,
} satisfies ExportedHandler<Env>;
```

Each entrypoint builds its own application context and invokes domain use cases. Entrypoints must not contain business logic.

### 3.2 Dependency direction

```text
HTTP / Email / Queue handlers
            ↓
        Use cases
            ↓
Domain services and repository interfaces
            ↓
D1 repositories, R2 storage, KV cache, provider adapters
```

Rules:

- Domain modules must not import Hono or Cloudflare request objects.
- Route handlers validate input and call one use case.
- Repositories own database queries.
- Provider adapters own third-party SDK calls and payload conversion.
- Shared contracts are consumed by both the Worker and the web client.
- Modules may depend only on another module's public interface.

### 3.3 Deployment bootstrap

The supported installation entrypoint is a **Deploy to Cloudflare** button, not a manual `.env` or account-ID editing procedure.

```text
Project README
  -> Deploy to Cloudflare
  -> Cloudflare account and repository selection
  -> Credential-free minimal deployment
  -> Cloudflare provisions and binds D1, KV, and Queue
  -> Operator explicitly runs deployment:bootstrap with initial credentials
  -> Bootstrap generates missing runtime secrets and runs migrations
  -> Bootstrap hashes the initial password into D1
  -> Worker opens at /login
```

Requirements:

- Declare required D1, KV, and Queue bindings in `wrangler.jsonc` without account-specific resource IDs. R2 is an optional overlay.
- Treat the repository root as one Worker deployment unit; the root build compiles shared packages, the Worker, and static web assets. Do not point the deploy button at a dependent monorepo subdirectory.
- The minimal deploy does not require `INITIAL_ADMIN_EMAIL` or `INITIAL_ADMIN_PASSWORD`; the explicit follow-up accepts them as one-time bootstrap inputs. They are not Worker runtime bindings.
- The bootstrap generates missing `AUTH_SIGNING_KEY` and `CREDENTIAL_ENCRYPTION_KEY` values securely, persists them as Worker secrets, and never logs their values.
- Resource IDs created by Cloudflare are deployment metadata, not application settings.
- The deploy command only publishes the minimal Worker and provisions bindings. The explicit bootstrap command then runs pending D1 migrations and idempotent administrator creation.
- The repository README contains the official button format:

```markdown
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=<PUBLIC_REPOSITORY_URL>)
```

Cloudflare currently supports automatic provisioning for D1, R2, KV, and Queues from binding declarations. Treat that behavior as an external platform contract and pin a tested Wrangler version. The default deployment declares D1, KV, and Queue; R2 remains optional. See the [Deploy to Cloudflare documentation](https://developers.cloudflare.com/workers/platform/deploy-buttons/) and [Wrangler automatic provisioning documentation](https://developers.cloudflare.com/workers/wrangler/configuration/#automatic-provisioning).

The one-click button requires a public GitHub or GitLab source repository. Private installations use Cloudflare's **Import a repository** flow with the same binding declarations and build command.

### 3.4 Deployment bootstrap and post-login configuration

There is no public claim or installation wizard. Before bootstrap completes, ordinary application routes return `503 BOOTSTRAP_INCOMPLETE`; `/health` remains available for diagnostics. The legacy `/setup` route redirects to `/login`, and public `/api/v1/setup/*` routes do not exist.

Deployment performs only these ordered prerequisites:

1. **Resource and schema preflight** — verify required D1, KV, Queue, Assets, migrations, and Worker build output.
2. **Runtime secrets** — inspect secret names and generate only missing signing/encryption secrets.
3. **Administrator** — validate the initial login email/password, derive the password record, and create the first administrator idempotently.
4. **Complete** — verify exactly one administrator role assignment and store installation state `complete`.

After login, administrators configure independent cards for Cloudflare/Email Routing, managed domains, inbound smoke testing, Brevo, outbound smoke testing, and optional R2. Each card has its own checkpoint and retry state. A failed external integration never returns the installation to an incomplete state or takes an existing inbox offline.

Cloudflare connection supports two explicit modes:

- **OAuth mode** is preferred when the distribution owns a registered Cloudflare OAuth client. Redirect through the Authorization Code flow, request only the account, zone, DNS, Worker, and Email Routing scopes required by Settings, encrypt tokens at rest, and allow revocation. The service may then call Cloudflare APIs to inspect Email Routing, enable its DNS records, and create Worker routing rules. See the [Cloudflare OAuth documentation](https://developers.cloudflare.com/fundamentals/oauth/) and [Email Routing API](https://developers.cloudflare.com/api/resources/email_routing/).
- **Dashboard-assisted mode** is mandatory for standalone deployments without a usable OAuth client. Open the relevant Cloudflare dashboard page in a new tab, display exact expected settings, and return to a verification step. The application verifies DNS and an inbound test message; it must not report success merely because the user clicked the link.

Do not ask users to paste a general-purpose Cloudflare API token into the application. Do not attempt to create or replace the Worker's own bindings at runtime; those bindings belong to the deployment bootstrap.

Installation exposes only deployment-owned states:

```typescript
export const InstallationStep = {
  ADMIN_BOOTSTRAP: "admin_bootstrap",
  COMPLETE: "complete",
} as const;

export type InstallationStep =
  (typeof InstallationStep)[keyof typeof InstallationStep];

export interface InstallationStatus {
  installationVersion: number;
  stateVersion: number;
  currentStep: InstallationStep;
  completedSteps: string[];
}
```

Deployment retries are idempotent: existing administrator and runtime-secret names are preserved. Post-login configuration checkpoints are audited independently.

## 4. Repository structure

```text
unimailbox/
├── apps/
│   ├── worker/
│   │   ├── src/
│   │   │   ├── entrypoints/
│   │   │   │   ├── http.ts
│   │   │   │   ├── inbound-email.ts
│   │   │   │   ├── queue.ts
│   │   │   │   └── scheduled.ts
│   │   │   ├── http/
│   │   │   │   ├── router.ts
│   │   │   │   ├── middleware/
│   │   │   │   └── errors.ts
│   │   │   ├── modules/
│   │   │   │   ├── identity/
│   │   │   │   ├── authorization/
│   │   │   │   ├── domains/
│   │   │   │   ├── mailboxes/
│   │   │   │   ├── messages/
│   │   │   │   ├── attachments/
│   │   │   │   ├── signatures/
│   │   │   │   ├── settings/
│   │   │   │   ├── inbound-mail/
│   │   │   │   ├── outbound-mail/
│   │   │   │   ├── provider-sync/
│   │   │   │   ├── installation/
│   │   │   │   ├── maintenance/
│   │   │   │   └── audit/
│   │   │   ├── integrations/
│   │   │   │   ├── providers/
│   │   │   │   │   ├── provider-adapter.ts
│   │   │   │   │   └── provider-registry.ts
│   │   │   │   ├── brevo/
│   │   │   │   └── cloudflare-control-plane/
│   │   │   ├── platform/
│   │   │   │   ├── config.ts
│   │   │   │   ├── database.ts
│   │   │   │   ├── object-store.ts
│   │   │   │   ├── cache.ts
│   │   │   │   ├── crypto.ts
│   │   │   │   └── logger.ts
│   │   │   └── app-context.ts
│   │   └── test/
│   └── web/
│       ├── src/
│       │   ├── app/
│       │   ├── features/
│       │   │   ├── auth/
│       │   │   ├── inbox/
│       │   │   ├── compose/
│       │   │   ├── mailboxes/
│       │   │   ├── signatures/
│       │   │   └── administration/
│       │   ├── components/
│       │   ├── infrastructure/
│       │   │   ├── api/
│       │   │   ├── indexed-db/
│       │   │   └── i18n/
│       │   └── styles/
│       └── test/
├── packages/
│   ├── contracts/
│   │   ├── src/api/
│   │   ├── src/events/
│   │   └── src/domain/
│   ├── email-core/
│   │   ├── src/composition/
│   │   ├── src/addressing/
│   │   └── src/threading/
│   ├── config/
│   └── test-kit/
├── migrations/
│   ├── 0001_initial.sql
│   ├── 0002_seed_permissions.sql
│   └── meta/
├── scripts/
│   ├── scaffold.mjs
│   ├── migration.mjs
│   ├── release.mjs
│   └── verify-deployment.mjs
├── .github/
│   └── workflows/
│       └── ci.yml
├── docs/
│   ├── api/
│   ├── adr/
│   └── operations/
├── drizzle.config.ts
├── wrangler.jsonc
├── pnpm-workspace.yaml
└── package.json
```

### 4.1 Feature module structure

Every business module uses the same internal pattern:

```text
modules/messages/
├── api/
│   ├── message.routes.ts
│   └── message.schemas.ts
├── application/
│   ├── send-message.ts
│   ├── list-messages.ts
│   └── mark-message-read.ts
├── domain/
│   ├── message.ts
│   ├── message-status.ts
│   └── message.errors.ts
├── infrastructure/
│   ├── d1-message.repository.ts
│   └── message.queries.ts
└── index.ts
```

Only `index.ts` is public to other modules.

## 5. Domain model

### 5.1 Core identifiers

Use UUID v4 strings for externally visible identifiers:

```typescript
export type UserId = string;
export type DomainId = string;
export type MailboxId = string;
export type MessageId = string;
export type AttachmentId = string;
export type SessionId = string;
```

Database-generated numeric IDs must not appear in public APIs.

### 5.2 Enumerations

```typescript
export const UserStatus = {
  ACTIVE: "active",
  SUSPENDED: "suspended",
  DELETED: "deleted",
} as const;

export const DomainStatus = {
  ACTIVE: "active",
  DISABLED: "disabled",
} as const;

export const MailboxRole = {
  VIEWER: "viewer",
  SENDER: "sender",
  ADMIN: "admin",
} as const;

export const MailboxFolder = {
  INBOX: "inbox",
  SENT: "sent",
  DRAFTS: "drafts",
  ARCHIVE: "archive",
  TRASH: "trash",
} as const;

export const MessageStatus = {
  DRAFT: "draft",
  QUEUED: "queued",
  SENDING: "sending",
  SENT: "sent",
  DELIVERED: "delivered",
  DELAYED: "delayed",
  BOUNCED: "bounced",
  COMPLAINED: "complained",
  FAILED: "failed",
  RECEIVED: "received",
} as const;

export const RecipientType = {
  TO: "to",
  CC: "cc",
  BCC: "bcc",
} as const;

export const AttachmentDisposition = {
  ATTACHMENT: "attachment",
  INLINE: "inline",
} as const;

export type ProviderKey = string & { readonly __brand: "ProviderKey" };

export const BREVO_PROVIDER_KEY = "brevo" as ProviderKey;

export function parseProviderKey(value: string): ProviderKey {
  if (!/^[a-z][a-z0-9_-]{1,31}$/.test(value)) {
    throw new DomainError("INVALID_PROVIDER_KEY", "Invalid provider key");
  }
  return value as ProviderKey;
}
```

Provider keys are extensible identifiers, not a closed domain enum. Message status and recipient type remain closed enums because their semantics are owned by this application.

### 5.3 Mailbox authorization

The mailbox owner is stored on the mailbox record. Delegated access is stored separately.

| Actor         | Read | Send | Rename | Manage members | Delete message | Delete mailbox |
| ------------- | :--: | :--: | :----: | :------------: | :------------: | :------------: |
| Owner         | Yes  | Yes  |  Yes   |      Yes       |      Yes       |      Yes       |
| Viewer        | Yes  |  No  |   No   |       No       |       No       |       No       |
| Sender        | Yes  | Yes  |   No   |       No       |       No       |       No       |
| Mailbox admin | Yes  | Yes  |  Yes   |      Yes       |       No       |       No       |

Global permissions and mailbox permissions are independent. A route may require both.

## 6. Database schema

The following schema is the initial D1 migration.

Store database timestamps in UTC using D1's `YYYY-MM-DD HH:MM:SS` format so indexed text comparisons remain chronological. Convert timestamps to RFC 3339 at the API boundary. Lock expiry fields use Unix epoch milliseconds.

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  password_algorithm TEXT NOT NULL DEFAULT 'pbkdf2-sha256',
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'deleted')),
  display_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  refresh_token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expiry ON sessions(expires_at);

CREATE TABLE idempotency_records (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  resource_id TEXT,
  response_status INTEGER NOT NULL,
  response_json TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (actor_user_id, operation, idempotency_key),
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_idempotency_records_expiry
  ON idempotency_records(expires_at);

CREATE TABLE roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE permissions (
  key TEXT PRIMARY KEY,
  description TEXT NOT NULL
);

CREATE TABLE role_permissions (
  role_id TEXT NOT NULL,
  permission_key TEXT NOT NULL,
  PRIMARY KEY (role_id, permission_key),
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  FOREIGN KEY (permission_key) REFERENCES permissions(key) ON DELETE CASCADE
);

CREATE TABLE user_roles (
  user_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  PRIMARY KEY (user_id, role_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
);

CREATE TABLE encrypted_credentials (
  id TEXT PRIMARY KEY,
  encrypted_payload TEXT NOT NULL,
  encryption_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE provider_connections (
  id TEXT PRIMARY KEY,
  provider_key TEXT NOT NULL,
  label TEXT NOT NULL,
  credential_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled', 'invalid')),
  config_json TEXT NOT NULL DEFAULT '{}',
  last_health_check_at TEXT,
  last_health_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (provider_key, label),
  FOREIGN KEY (credential_id) REFERENCES encrypted_credentials(id)
);

CREATE INDEX idx_provider_connections_key
  ON provider_connections(provider_key, status);

CREATE TABLE domains (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled')),
  outbound_connection_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (outbound_connection_id) REFERENCES provider_connections(id)
);

CREATE TABLE mailboxes (
  id TEXT PRIMARY KEY,
  domain_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  address TEXT NOT NULL COLLATE NOCASE UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled', 'deleted')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (domain_id) REFERENCES domains(id),
  FOREIGN KEY (owner_user_id) REFERENCES users(id)
);

CREATE INDEX idx_mailboxes_owner ON mailboxes(owner_user_id);
CREATE INDEX idx_mailboxes_domain ON mailboxes(domain_id);

CREATE TABLE mailbox_members (
  mailbox_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL
    CHECK (role IN ('viewer', 'sender', 'admin')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (mailbox_id, user_id),
  FOREIGN KEY (mailbox_id) REFERENCES mailboxes(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_mailbox_members_user ON mailbox_members(user_id);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT,
  from_address TEXT NOT NULL COLLATE NOCASE,
  from_name TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  html_body TEXT NOT NULL DEFAULT '',
  text_body TEXT NOT NULL DEFAULT '',
  message_id_header TEXT,
  in_reply_to_header TEXT,
  references_header TEXT NOT NULL DEFAULT '',
  provider_key TEXT,
  provider_connection_id TEXT,
  provider_message_id TEXT,
  status TEXT NOT NULL
    CHECK (
      status IN (
        'draft', 'queued', 'sending', 'sent', 'delivered',
        'delayed', 'bounced', 'complained', 'failed', 'received'
      )
    ),
  error_code TEXT,
  error_message TEXT,
  raw_object_key TEXT,
  created_by_user_id TEXT,
  sent_at TEXT,
  received_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id),
  FOREIGN KEY (provider_connection_id) REFERENCES provider_connections(id),
  UNIQUE (provider_connection_id, provider_message_id)
);

CREATE INDEX idx_messages_thread ON messages(thread_id);
CREATE INDEX idx_messages_status ON messages(status);
CREATE INDEX idx_messages_created_at ON messages(created_at);

CREATE TABLE outbound_jobs (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'enqueued', 'processing', 'succeeded', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  lock_token TEXT,
  lock_expires_at INTEGER,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);

CREATE INDEX idx_outbound_jobs_dispatch
  ON outbound_jobs(status, available_at);

CREATE TABLE message_recipients (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('to', 'cc', 'bcc')),
  address TEXT NOT NULL COLLATE NOCASE,
  display_name TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);

CREATE INDEX idx_message_recipients_message ON message_recipients(message_id);
CREATE INDEX idx_message_recipients_address ON message_recipients(address);

CREATE TABLE mailbox_messages (
  id TEXT PRIMARY KEY,
  mailbox_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  folder TEXT NOT NULL
    CHECK (folder IN ('inbox', 'sent', 'drafts', 'archive', 'trash')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (mailbox_id, message_id, folder),
  FOREIGN KEY (mailbox_id) REFERENCES mailboxes(id) ON DELETE CASCADE,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);

CREATE INDEX idx_mailbox_messages_page
  ON mailbox_messages(mailbox_id, folder, created_at DESC, id DESC);

CREATE TABLE message_user_state (
  mailbox_message_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)),
  is_starred INTEGER NOT NULL DEFAULT 0 CHECK (is_starred IN (0, 1)),
  deleted_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (mailbox_message_id, user_id),
  FOREIGN KEY (mailbox_message_id)
    REFERENCES mailbox_messages(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE attachment_uploads (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  disposition TEXT NOT NULL
    CHECK (disposition IN ('attachment', 'inline')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'uploaded', 'consumed', 'expired')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  consumed_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_attachment_uploads_cleanup
  ON attachment_uploads(status, expires_at);

CREATE TABLE message_attachments (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  upload_id TEXT UNIQUE,
  object_key TEXT NOT NULL,
  filename TEXT,
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  disposition TEXT NOT NULL
    CHECK (disposition IN ('attachment', 'inline')),
  content_id TEXT,
  sha256 TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  FOREIGN KEY (upload_id) REFERENCES attachment_uploads(id) ON DELETE SET NULL
);

CREATE INDEX idx_message_attachments_message
  ON message_attachments(message_id);
CREATE INDEX idx_message_attachments_object
  ON message_attachments(object_key);

CREATE TRIGGER validate_attachment_upload
BEFORE INSERT ON message_attachments
WHEN NEW.upload_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM attachment_uploads AS upload
    JOIN messages AS message ON message.id = NEW.message_id
    WHERE upload.id = NEW.upload_id
      AND upload.user_id = message.created_by_user_id
      AND upload.status = 'uploaded'
      AND upload.expires_at > CURRENT_TIMESTAMP
      AND upload.object_key = NEW.object_key
      AND upload.size_bytes = NEW.size_bytes
  )
  THEN RAISE(ABORT, 'invalid attachment upload')
  END;
END;

CREATE TRIGGER consume_attachment_upload
AFTER INSERT ON message_attachments
WHEN NEW.upload_id IS NOT NULL
BEGIN
  UPDATE attachment_uploads
  SET status = 'consumed',
      consumed_at = CURRENT_TIMESTAMP
  WHERE id = NEW.upload_id;
END;

CREATE TABLE domain_signatures (
  id TEXT PRIMARY KEY,
  domain_id TEXT NOT NULL UNIQUE,
  html_content TEXT NOT NULL DEFAULT '',
  text_content TEXT NOT NULL DEFAULT '',
  is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE
);

CREATE TABLE registration_keys (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  role_id TEXT,
  max_uses INTEGER NOT NULL DEFAULT 1,
  used_count INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  revoked_at TEXT,
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (role_id) REFERENCES roles(id),
  FOREIGN KEY (created_by_user_id) REFERENCES users(id)
);

CREATE TABLE oauth_accounts (
  id TEXT PRIMARY KEY,
  identity_provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  profile_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (identity_provider, provider_user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE provider_message_state (
  provider_connection_id TEXT NOT NULL,
  provider_key TEXT NOT NULL,
  provider_message_id TEXT NOT NULL,
  message_id TEXT,
  status_event_time INTEGER,
  status_rank INTEGER NOT NULL DEFAULT 0,
  import_lock_token TEXT,
  import_lock_expires_at INTEGER,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (provider_connection_id, provider_message_id),
  FOREIGN KEY (provider_connection_id)
    REFERENCES provider_connections(id) ON DELETE CASCADE,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE SET NULL
);

CREATE INDEX idx_provider_message_state_message
  ON provider_message_state(message_id);

CREATE TABLE webhook_deliveries (
  provider_connection_id TEXT NOT NULL,
  provider_key TEXT NOT NULL,
  event_key TEXT NOT NULL,
  event_time INTEGER NOT NULL,
  processing_status TEXT NOT NULL
    CHECK (processing_status IN ('processing', 'succeeded', 'ignored', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 1,
  lock_token TEXT,
  lock_expires_at INTEGER,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (provider_connection_id, event_key),
  FOREIGN KEY (provider_connection_id)
    REFERENCES provider_connections(id) ON DELETE CASCADE
);

CREATE INDEX idx_webhook_deliveries_status
  ON webhook_deliveries(processing_status, updated_at);

CREATE TABLE webhook_events (
  id TEXT PRIMARY KEY,
  provider_connection_id TEXT NOT NULL,
  provider_key TEXT NOT NULL,
  event_type TEXT NOT NULL,
  provider_message_id TEXT,
  message_id TEXT,
  recipient TEXT,
  mapped_status TEXT,
  reason TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (provider_connection_id)
    REFERENCES provider_connections(id) ON DELETE CASCADE,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE SET NULL
);

CREATE INDEX idx_webhook_events_provider_time
  ON webhook_events(provider_connection_id, created_at DESC);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  request_id TEXT NOT NULL,
  ip_address TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_audit_events_resource
  ON audit_events(resource_type, resource_id, created_at DESC);

CREATE INDEX idx_audit_events_actor
  ON audit_events(actor_user_id, created_at DESC);

CREATE TABLE installation_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  installation_version INTEGER NOT NULL DEFAULT 1,
  state_version INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'complete')),
  current_step TEXT NOT NULL DEFAULT 'claim',
  completed_steps_json TEXT NOT NULL DEFAULT '[]',
  cloudflare_account_id TEXT,
  cloudflare_zone_id TEXT,
  cloudflare_credential_id TEXT,
  claimed_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cloudflare_credential_id) REFERENCES encrypted_credentials(id)
);

CREATE TABLE maintenance_jobs (
  id TEXT PRIMARY KEY,
  job_key TEXT NOT NULL UNIQUE,
  migration_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  cursor_json TEXT NOT NULL DEFAULT '{}',
  attempts INTEGER NOT NULL DEFAULT 0,
  lock_token TEXT,
  lock_expires_at INTEGER,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE INDEX idx_maintenance_jobs_runnable
  ON maintenance_jobs(status, updated_at);

CREATE TABLE system_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  site_title TEXT NOT NULL DEFAULT 'UniMailbox',
  registration_enabled INTEGER NOT NULL DEFAULT 0,
  invite_required INTEGER NOT NULL DEFAULT 1,
  inbound_enabled INTEGER NOT NULL DEFAULT 1,
  outbound_enabled INTEGER NOT NULL DEFAULT 1,
  unknown_recipient_policy TEXT NOT NULL DEFAULT 'reject'
    CHECK (unknown_recipient_policy IN ('reject', 'store')),
  max_mailboxes_per_user INTEGER NOT NULL DEFAULT 10,
  max_attachments_per_message INTEGER NOT NULL DEFAULT 10,
  max_attachment_bytes INTEGER NOT NULL DEFAULT 67108864,
  sender_blocklist_json TEXT NOT NULL DEFAULT '[]',
  subject_blocklist_json TEXT NOT NULL DEFAULT '[]',
  content_blocklist_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO system_settings (id) VALUES (1);
INSERT INTO installation_state (id) VALUES (1);
```

### 6.1 Data ownership

- `messages` stores canonical message content.
- `mailbox_messages` links one message to one or more mailboxes.
- `message_user_state` stores read, star, and delete state per user.
- A missing `message_user_state` row means unread, unstarred, and not deleted; create the row on the user's first state mutation.
- `message_recipients` is the canonical TO/CC/BCC model.
- `attachment_uploads` owns temporary upload authorization before a message exists.
- `message_attachments` stores metadata only; bytes remain in R2.
- `outbound_jobs` is the durable outbox between D1 and Cloudflare Queues.
- `idempotency_records` binds one authenticated command key to its canonical request hash and response.
- Provider identity is always `(provider_connection_id, provider_message_id)`; `provider_key` selects the adapter.
- `provider_connections` selects credentials and provider-specific configuration without leaking them into domain logic.
- `installation_state` is the resumable first-run state machine; setup sessions and OAuth state are short-lived KV records.
- `maintenance_jobs` stores resumable cursor state for bounded data backfills.

### 6.2 Deletion rules

- User deletion revokes sessions immediately.
- Mailbox deletion requires the owner.
- Removing a mailbox member deletes only the membership.
- Deleting a message from the UI sets `message_user_state.deleted_at`.
- Database triggers validate upload ownership, status, expiry, object key, and size before attachment insertion, then mark the upload `consumed`.
- A retention job may remove `mailbox_messages` and canonical message data only when no user-visible relation remains.
- R2 objects are deleted only when no attachment row references the object key.

## 7. Business logic

### 7.1 Authentication

1. Normalize email with trim and lowercase.
2. Hash passwords with Web Crypto PBKDF2-SHA256, a random salt of at least 16 bytes, and a centrally configured work factor approved and benchmarked at implementation time.
3. Store the algorithm and work factor per user; rehash after successful login when the stored policy is weaker than the active policy.
4. Return a 15-minute signed access token.
5. Return a random refresh token whose hash is stored in `sessions`.
6. Rotate the refresh token on every refresh.
7. Revoke all sessions after password reset, suspension, or explicit logout-all.
8. Rate-limit login by normalized email and client IP.
9. Never return password hashes, salts, refresh-token hashes, or credential payloads.

### 7.2 Global authorization

Recommended permission keys:

```text
message.read
message.send
message.delete
mailbox.create
mailbox.manage
mailbox.share
user.read
user.manage
role.read
role.manage
domain.read
domain.manage
signature.read
signature.manage
settings.read
settings.manage
provider.sync
webhook_event.read
webhook_event.delete
analytics.read
```

Permissions are checked on the server for every protected route.

A required, idempotent seed step inserts the permission keys and two system roles. `administrator` receives every permission. `member` receives `message.read`, `message.send`, `message.delete`, `mailbox.create`, `mailbox.manage`, and `mailbox.share`; target-mailbox authorization still applies. Create the first administrator only through the claimed setup session; public registration must never grant administrative access.

### 7.3 Managed domains

- Only active domains may create mailboxes or send messages.
- Mailbox addresses must belong to an active managed domain.
- Addresses are case-insensitive and globally unique.
- A domain selects one active `provider_connections` row for outbound delivery.
- Provider connections may use any adapter registered by the runtime; the
  built-in keys are `brevo` and `resend`.
- Provider selection fails when the connection is disabled, invalid, or has no registered adapter.
- Provider credentials are entered through the setup or administration UI and encrypted with AES-GCM using the Secrets Store master key.

### 7.4 Mailbox creation

1. Require `mailbox.create`.
2. Validate the local part and managed domain.
3. Reject reserved or blocked local parts.
4. Enforce the mailbox quota.
5. Insert the mailbox with the caller as owner.
6. Return the mailbox without provider credentials or internal metadata.

### 7.5 Mailbox sharing

- Owners and mailbox admins may add, update, or remove members.
- The owner cannot be inserted into `mailbox_members`.
- A user may remove their own membership.
- A member role change is an audited action.
- Mailbox authorization is evaluated using the target mailbox ID, never a client-provided owner ID.

### 7.6 Domain signatures

- Each domain has at most one signature.
- Signature HTML is sanitized before storage.
- Script tags, event-handler attributes, unsafe URLs, and embedded forms are rejected.
- Signature inclusion defaults to enabled for compose.
- The separator is `-- ` according to RFC 3676.
- On reply, the signature is inserted before the quoted message.
- Plain-text signature content is stored separately and appended to the text body.

### 7.7 Reply threading

For a reply:

```text
In-Reply-To = parent Message-ID
References = parent References + parent Message-ID
```

The resulting `References` value must:

- Preserve order
- Remove duplicate message IDs
- Exclude empty tokens
- Be bounded to a documented maximum length

### 7.8 Inbound message flow

```text
Email Routing event
  -> read raw bytes once
  -> parse MIME
  -> validate receive switch
  -> apply sender, subject, and content blocklists
  -> resolve recipient mailbox
  -> upload raw message and attachment objects
  -> insert message, recipients, attachments, and mailbox relation
  -> initialize user state
  -> emit audit event
  -> enqueue notification and forwarding jobs
```

Rules:

- Read the raw message as `ArrayBuffer`; do not concatenate independently decoded chunks.
- Preserve `Message-ID`, `In-Reply-To`, and `References`.
- A missing filename is valid attachment metadata.
- Inline attachments retain `Content-ID`.
- If the recipient does not exist, follow `unknown_recipient_policy`.
- Store the original `.eml` object when protocol export or forensic retention is required.
- Database writes use one D1 batch after object uploads succeed.
- Failed database writes enqueue orphan-object cleanup.

### 7.9 Draft lifecycle

- The server is authoritative for explicitly saved drafts; IndexedDB is only the browser's crash-recovery working copy.
- Creating a draft requires send access to the selected mailbox.
- A draft uses `messages.status = 'draft'` and a `mailbox_messages.folder = 'drafts'` relation.
- Only `created_by_user_id` may read, update, send, or delete a draft, even when the sender mailbox is shared.
- Saving a draft replaces recipients and editable content using optimistic concurrency on `updated_at`.
- Newly uploaded attachments are consumed when attached to a saved draft. Removing one deletes its metadata and schedules the unreferenced R2 object for cleanup.
- Sending a draft is one D1 batch: verify the expected draft version, change its status to `queued` or `sent`, move the sender relation from `drafts` to `sent`, create internal recipient relations, and create an outbound job only for external recipients.
- A successful send transition is irreversible through the draft API. Repeated requests with the same idempotency key return the same result.

### 7.10 Outbound message flow

```text
POST compose request
  -> validate addresses and attachment references
  -> authorize sender mailbox
  -> enforce domain and sending policy
  -> partition internal and external recipients
  -> resolve signature
  -> construct reply headers
  -> atomically create message graph and internal mailbox relations
  -> create a pending outbound job only when external recipients exist
  -> attempt immediate queue dispatch
  -> scheduled dispatcher recovers pending jobs
  -> queue consumer selects provider
  -> provider sends message
  -> update provider ID and delivery status
```

Rules:

- The sender must be owner, sender, or mailbox admin.
- TO, CC, and BCC are stored separately.
- At least one TO recipient is required.
- Duplicate addresses are removed within each recipient type.
- An address present in TO must be removed from CC and BCC.
- An address present in CC must be removed from BCC.
- The message, recipients, attachments, sender relation, internal recipient relations, and optional `outbound_jobs` row are persisted in one D1 batch.
- An internal-only message is stored as `sent` without an outbound job or provider call.
- A mixed message is delivered internally in the initial batch; only external recipients are included in the provider payload.
- Send requests require an `Idempotency-Key`. The message graph and completed idempotency record are inserted in the same batch.
- Reusing a key with the same canonical request hash returns the stored response; reusing it with different input returns `409 IDEMPOTENCY_KEY_REUSED`.
- A queue-send failure does not lose the message; the pending outbox row remains eligible for scheduled dispatch.
- Queue submission is at least once. The consumer claim and provider idempotency key use the stable message ID.
- Queue delivery is idempotent by message ID.
- A terminal provider failure changes status to `failed` and stores a sanitized error.
- A retryable provider failure keeps the job eligible until the attempt limit is reached.
- Successful provider submission changes status to `sent`.
- Webhooks advance the message to delivered, delayed, bounced, complained, or failed.

### 7.11 Internal delivery

For every recipient whose address matches an active mailbox:

1. Create an inbox `mailbox_messages` relation for the same canonical message.
2. Treat missing per-user state as unread, unstarred, and not deleted; create it lazily on mutation.
3. Perform the mailbox writes in the same D1 batch that creates the sender relation.
4. Do not create an outbound job when all recipients are internal.
5. For a mixed recipient set, send only external recipients through the provider.

### 7.12 Provider selection

```typescript
export function selectProviderConnection(input: {
  connection: ProviderConnection;
  registeredProviders: ReadonlySet<ProviderKey>;
}): ProviderConnection {
  if (input.connection.status !== "active") {
    throw new DomainError(
      "PROVIDER_CONNECTION_INACTIVE",
      "The outbound provider connection is not active",
    );
  }

  if (!input.registeredProviders.has(input.connection.providerKey)) {
    throw new DomainError(
      "PROVIDER_NOT_CONFIGURED",
      `Provider ${input.connection.providerKey} has no registered adapter`,
    );
  }

  return input.connection;
}
```

Provider selection must never silently fall back to a different connection or provider. The registry contains `brevo` and `resend`; a managed domain selects one active configured connection through the administration selector.

### 7.13 Message-status ordering

Use provider event time plus a status rank:

```typescript
export const statusRank: Record<MessageStatus, number> = {
  draft: 0,
  queued: 10,
  sending: 20,
  sent: 30,
  delayed: 40,
  delivered: 50,
  bounced: 60,
  failed: 60,
  complained: 70,
  received: 100,
};
```

Apply a provider status when:

- No provider status exists, or
- The event time is newer, or
- The event time is equal and the new rank is greater than or equal to the stored rank.

### 7.14 Webhook processing

1. Read the raw request body.
2. Verify provider credentials before JSON processing.
3. Build a deterministic event key.
4. Claim the event in `webhook_deliveries`.
5. Return success for an already completed event.
6. Locate the message by provider and provider message ID.
7. If missing, claim an import lock and fetch provider detail.
8. Insert the message once.
9. Apply status ordering.
10. Resolve and persist the managed domain from the original message or the
    provider detail sender, rejecting cross-domain events.
11. Write the webhook audit record with `domain_id`.
12. Complete the delivery claim with the same `domain_id`.

Failed claims may be retried after the lock expires.

### 7.15 Provider synchronization

Manual synchronization is an administrator operation.

- Iterate every configured provider account.
- Page until the provider reports no next page.
- Use a strict page limit to prevent runaway execution.
- Update status for known provider messages.
- Fetch detail and insert unknown messages.
- Deduplicate by `(provider_connection_id, provider_message_id)`.
- Return inserted, updated, skipped, and failed counts.
- Emit structured stage logs.

## 8. Attachment design

### 8.1 Limits

```typescript
export const MAX_ATTACHMENTS_PER_MESSAGE = 10;
export const MAX_ATTACHMENT_BYTES = 64 * 1024 * 1024;
export const PRESIGN_TTL_SECONDS = 300;
```

### 8.2 Direct-upload flow

1. Browser requests a presigned upload.
2. Worker validates filename, MIME type, size, and disposition.
3. Worker inserts a `pending` upload row with the authenticated user, random object key, and expiry.
4. Browser uploads bytes directly to R2.
5. Browser calls the completion endpoint with the upload ID.
6. Worker uses `R2.head` to verify object existence, canonical size, and signed metadata, then changes the row to `uploaded`.
7. Compose submits only completed upload IDs.
8. Message creation inserts `message_attachments`; database triggers validate and atomically consume each upload.

Object-key format:

```text
attachments/{uuid-v4}[.{safe-extension}]
```

The browser never receives R2 credentials.

An upload ID is usable only when it belongs to the caller, has status `uploaded`, has not expired, and still matches the R2 object metadata. Completion and message creation are idempotent. Reusing a consumed upload must return `409 ATTACHMENT_ALREADY_CONSUMED`.

### 8.3 Presign request

```typescript
export const CreateAttachmentUploadSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(255),
  size: z.number().int().positive().max(MAX_ATTACHMENT_BYTES),
  disposition: z.enum(["attachment", "inline"]).default("attachment"),
});
```

### 8.4 Presign response

```typescript
export interface AttachmentUpload {
  attachmentId: string;
  objectKey: string;
  uploadUrl: string;
  uploadHeaders: Record<string, string>;
  expiresAt: string;
}
```

Required signed headers:

- `Content-Length`
- `Content-Type`
- `Content-Disposition`
- `x-amz-meta-filename`

### 8.5 Attachment access

Attachment download uses an authenticated API:

```text
GET /api/v1/attachments/:attachmentId/download
```

The API:

1. Resolves the attachment and message.
2. Confirms the caller can read at least one linked mailbox message.
3. Returns a short-lived signed R2 URL or streams the object.
4. Adds `X-Content-Type-Options: nosniff`.
5. Uses `Content-Disposition: attachment` unless the stored disposition is explicitly inline and the MIME type is allowed.

## 9. Provider interfaces

### 9.1 Provider-neutral model

```typescript
export interface MailAddress {
  address: string;
  name?: string;
}

export interface ProviderAttachment {
  filename: string | null;
  contentType: string;
  disposition: "attachment" | "inline";
  contentId?: string;
  content: ArrayBuffer;
}

export interface SendProviderMessage {
  idempotencyKey: string;
  from: MailAddress;
  to: MailAddress[];
  cc: MailAddress[];
  bcc: MailAddress[];
  subject: string;
  html: string;
  text: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string;
  attachments: ProviderAttachment[];
}

export interface ProviderSendResult {
  providerMessageId: string;
  acceptedAt: string;
}

export interface ProviderEvent {
  providerKey: ProviderKey;
  connectionId: string;
  eventKey: string;
  providerMessageId: string;
  status: MessageStatus;
  occurredAt: Date;
  recipient?: string;
  error?: SafeProviderError;
}

export interface ProviderRuntimeContext {
  connectionId: string;
  config: Readonly<Record<string, unknown>>;
  secrets: Readonly<Record<string, string>>;
}

export interface OutboundProviderAdapter {
  readonly key: ProviderKey;
  validateConnection(context: ProviderRuntimeContext): Promise<void>;
  send(
    context: ProviderRuntimeContext,
    message: SendProviderMessage,
  ): Promise<ProviderSendResult>;
}

export interface WebhookProviderAdapter {
  readonly key: ProviderKey;
  verifyWebhook(
    context: ProviderRuntimeContext,
    request: ProviderWebhookRequest,
  ): Promise<ProviderEvent>;
}

export interface SyncProviderAdapter {
  readonly key: ProviderKey;
  getMessage(
    context: ProviderRuntimeContext,
    providerMessageId: string,
  ): Promise<ProviderMessageDetail>;
  listMessages(
    context: ProviderRuntimeContext,
    cursor?: string,
  ): Promise<ProviderMessagePage>;
}

export interface ProviderPlugin {
  outbound: OutboundProviderAdapter;
  webhook?: WebhookProviderAdapter;
  sync?: SyncProviderAdapter;
  connectionSchema: z.ZodType<unknown>;
}
```

### 9.2 Registry

```typescript
export class ProviderRegistry {
  constructor(
    private readonly providers: ReadonlyMap<ProviderKey, ProviderPlugin>,
  ) {
    for (const [key, plugin] of providers) {
      const declaredKeys = [
        plugin.outbound.key,
        plugin.webhook?.key,
        plugin.sync?.key,
      ].filter(Boolean);

      if (declaredKeys.some((declaredKey) => declaredKey !== key)) {
        throw new Error(`Provider plugin key mismatch for ${key}`);
      }
    }
  }

  get(providerKey: ProviderKey): ProviderPlugin {
    const plugin = this.providers.get(providerKey);
    if (!plugin) {
      throw new DomainError(
        "PROVIDER_ADAPTER_NOT_REGISTERED",
        `Provider ${providerKey} is not registered`,
      );
    }
    return plugin;
  }
}

export const providerRegistry = new ProviderRegistry(
  new Map([
    [BREVO_PROVIDER_KEY, createBrevoProviderPlugin()],
    [RESEND_PROVIDER_KEY, createResendProviderPlugin()],
  ]),
);
```

Application use cases depend on `ProviderRegistry` and the provider-neutral interfaces. They must not import a Brevo SDK, inspect a Brevo payload, or branch on `providerKey`.

Adding another provider requires only:

1. A new integration package implementing the adapter capabilities.
2. A connection schema and setup UI contributed by that plugin.
3. Provider event-to-domain status mapping.
4. Registry registration in the composition root.
5. Contract, webhook, idempotency, and failure-mapping tests.

No message table rewrite, send-use-case branch, or route fork is allowed.

### 9.3 Brevo adapter: initial implementation

- Use `brevo` as the stable provider key.
- Keep TO, CC, and BCC as separate provider fields.
- Omit empty recipient display names.
- Convert ordinary attachments to provider-required base64.
- Rewrite CID image references to signed or public object URLs when the provider cannot preserve inline MIME parts.
- Authenticate webhooks before JSON mapping using the connection's encrypted verification secret.
- Map Brevo event names into the application status enum inside the plugin.
- Pass the stable message ID as the Brevo idempotency key when the endpoint supports it.
- Classify Brevo errors as retryable, terminal, authentication, rate-limit, or invalid-payload errors.

### 9.4 Resend adapter

- Send through `POST /emails` with the application idempotency key.
- Verify the raw webhook body and `svix-id`, `svix-timestamp`, and
  `svix-signature` headers before parsing events.
- Use the Resend email ID as the connection-scoped provider identity and fetch
  `GET /emails/:id` when a verified webhook references an unknown message.
- Map Resend delivery, delay, bounce, complaint, suppression, and failure
  events into the application status enum inside the plugin.
- Keep pagination and message-detail logic inside the Brevo sync capability.
- Never expose the Brevo API key through API responses, logs, or client-side code.

## 10. Core application code

### 10.1 Environment contract

```typescript
export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  /** Optional. When present, raw messages and attachments go to R2.
   *  When absent, the KV-backed default backend is used. */
  ATTACHMENTS?: R2Bucket;
  OUTBOUND_QUEUE: Queue<OutboundMailJob>;
  ASSETS: Fetcher;
  AUTH_SIGNING_KEY: string;
  CREDENTIAL_ENCRYPTION_KEY: string;
}
```

These are deployment bindings provisioned or generated during release, not a user-edited `.env` contract. Initial administrator credentials are one-time bootstrap inputs and do not belong to `Env`. Brevo credentials and application settings do not belong here.

Parse and validate secret bindings once:

```typescript
const RuntimeConfigSchema = z.object({
  AUTH_SIGNING_KEY: z.string().min(32),
  CREDENTIAL_ENCRYPTION_KEY: z.string().min(32),
});

export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>;
```

### 10.2 Application context

```typescript
export interface AppContext {
  db: Database;
  users: UserRepository;
  sessions: SessionRepository;
  domains: DomainRepository;
  mailboxes: MailboxRepository;
  messages: MessageRepository;
  attachments: AttachmentRepository;
  signatures: SignatureRepository;
  webhooks: WebhookRepository;
  audit: AuditRepository;
  installation: InstallationService;
  providerConnections: ProviderConnectionRepository;
  credentials: EncryptedCredentialStore;
  cloudflare: CloudflareControlPlane;
  outboundJobs: OutboundJobService;
  objectStore: ObjectStore;
  providers: ProviderRegistry;
  logger: Logger;
  clock: Clock;
  ids: IdGenerator;
}
```

### 10.2.1 Setup transition

```typescript
export interface CloudflareControlPlane {
  createAuthorizationUrl(state: string, codeChallenge: string): URL;
  exchangeAuthorizationCode(code: string, verifier: string): Promise<void>;
  verifyEmailRouting(zoneId: string): Promise<EmailRoutingStatus>;
  enableEmailRouting(zoneId: string): Promise<void>;
  upsertWorkerRoute(input: WorkerEmailRoute): Promise<void>;
  createDashboardUrl(input: DashboardDestination): URL;
}

export class InstallationService {
  constructor(
    private readonly installation: InstallationRepository,
    private readonly audit: AuditRepository,
  ) {}

  async advance(input: {
    expected: InstallationStep;
    next: InstallationStep;
    requestId: string;
    verify: () => Promise<void>;
  }): Promise<InstallationStatus> {
    const state = await this.installation.requireCurrent(input.expected);
    await input.verify();

    return this.installation.advanceCompareAndSet({
      stateVersion: state.stateVersion,
      completedStep: input.expected,
      nextStep: input.next,
      requestId: input.requestId,
    });
  }
}
```

OAuth state, PKCE verifier, and setup session live in KV with a short TTL and one-time consumption. `advanceCompareAndSet` prevents two browser tabs from completing conflicting steps. Dashboard URLs must be built from allowlisted Cloudflare destinations; never redirect to a caller-supplied URL.

### 10.3 Error model

```typescript
export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId: string;
  };
}
```

Use real HTTP status codes:

| Condition                         | Status |
| --------------------------------- | -----: |
| Validation failure                |    400 |
| Missing or invalid authentication |    401 |
| Insufficient permission           |    403 |
| Missing resource                  |    404 |
| Uniqueness or state conflict      |    409 |
| Size limit                        |    413 |
| Rate limit                        |    429 |
| Provider unavailable              |    502 |
| Temporary lock contention         |    503 |

### 10.4 Authentication middleware

```typescript
export function requireAuth(auth: AuthService) {
  return createMiddleware<AppBindings>(async (c, next) => {
    const header = c.req.header("Authorization");
    const token = header?.match(/^Bearer\s+(.+)$/i)?.[1];

    if (!token) {
      throw new DomainError("AUTH_REQUIRED", "Authentication is required", 401);
    }

    const principal = await auth.verifyAccessToken(token);
    c.set("principal", principal);
    await next();
  });
}
```

### 10.5 Permission middleware

```typescript
export function requirePermission(permission: PermissionKey) {
  return createMiddleware<AppBindings>(async (c, next) => {
    const principal = c.get("principal");

    if (!principal.permissions.has(permission)) {
      throw new DomainError(
        "PERMISSION_DENIED",
        `Permission ${permission} is required`,
        403,
      );
    }

    await next();
  });
}
```

### 10.6 Mailbox authorization

```typescript
type MailboxOperation =
  | "read"
  | "send"
  | "rename"
  | "manage_members"
  | "delete_message"
  | "delete_mailbox";

const roleOperations: Record<string, ReadonlySet<MailboxOperation>> = {
  owner: new Set([
    "read",
    "send",
    "rename",
    "manage_members",
    "delete_message",
    "delete_mailbox",
  ]),
  viewer: new Set(["read"]),
  sender: new Set(["read", "send"]),
  admin: new Set(["read", "send", "rename", "manage_members"]),
};

export async function assertMailboxOperation(
  repo: MailboxRepository,
  userId: UserId,
  mailboxId: MailboxId,
  operation: MailboxOperation,
): Promise<void> {
  const access = await repo.findAccess(userId, mailboxId);

  if (!access || !roleOperations[access.role]?.has(operation)) {
    throw new DomainError(
      "MAILBOX_PERMISSION_DENIED",
      "The operation is not permitted for this mailbox",
      403,
    );
  }
}
```

### 10.7 Send-message schema

```typescript
const AddressSchema = z
  .string()
  .trim()
  .email()
  .transform((value) => value.toLowerCase());

export const SendMessageSchema = z.object({
  mailboxId: z.string().uuid(),
  to: z.array(AddressSchema).min(1).max(100),
  cc: z.array(AddressSchema).max(100).default([]),
  bcc: z.array(AddressSchema).max(100).default([]),
  subject: z.string().max(998).default(""),
  html: z.string().max(2_000_000).default(""),
  text: z.string().max(2_000_000).default(""),
  parentMessageId: z.string().uuid().optional(),
  includeSignature: z.boolean().default(true),
  attachmentIds: z.array(z.string().uuid()).max(10).default([]),
});
```

### 10.8 Send-message use case

```typescript
export interface IdempotentCommand {
  key: string;
  requestHash: string;
}

export class SendMessage {
  constructor(private readonly ctx: AppContext) {}

  async execute(
    principal: Principal,
    input: z.infer<typeof SendMessageSchema>,
    command: IdempotentCommand,
  ): Promise<{ messageId: MessageId; status: "queued" | "sent" }> {
    const replay = await this.ctx.messages.findIdempotentResult(
      principal.userId,
      "message.send",
      command,
    );
    if (replay) return replay;

    await assertMailboxOperation(
      this.ctx.mailboxes,
      principal.userId,
      input.mailboxId,
      "send",
    );

    const mailbox = await this.ctx.mailboxes.requireActive(input.mailboxId);
    const domain = await this.ctx.domains.requireActive(mailbox.domainId);
    const recipients = normalizeRecipients(input.to, input.cc, input.bcc);
    const delivery = await this.ctx.mailboxes.partitionRecipients(recipients);
    const attachments = await this.ctx.attachments.requireUploaded(
      principal.userId,
      input.attachmentIds,
    );

    const composed = await composeMessage({
      mailbox,
      recipients,
      subject: input.subject,
      html: input.html,
      text: input.text,
      parentMessageId: input.parentMessageId,
      includeSignature: input.includeSignature,
      signature: await this.ctx.signatures.findEnabled(domain.id),
    });

    const messageId = this.ctx.ids.uuid();
    const jobId = delivery.external.length > 0 ? this.ctx.ids.uuid() : null;
    const providerConnection = jobId
      ? await this.ctx.domains.requireOutboundConnection(domain.id)
      : null;

    try {
      await this.ctx.messages.createForDelivery({
        messageId,
        jobId,
        createdByUserId: principal.userId,
        mailbox,
        composed,
        attachments,
        internalRecipients: delivery.internal,
        externalRecipients: delivery.external,
        providerConnection,
        idempotency: {
          actorUserId: principal.userId,
          operation: "message.send",
          ...command,
        },
      });
    } catch (error) {
      if (!isIdempotencyUniqueConflict(error)) throw error;

      return this.ctx.messages.requireIdempotentResult(
        principal.userId,
        "message.send",
        command,
      );
    }

    if (jobId) {
      try {
        await this.ctx.outboundJobs.dispatch(jobId);
      } catch (error) {
        this.ctx.logger.warn("outbound.dispatch.deferred", {
          jobId,
          messageId,
          error: toSafeProviderError(error),
        });
      }
    }

    return {
      messageId,
      status: jobId ? "queued" : "sent",
    };
  }
}
```

`createForDelivery` must write the complete message graph, internal mailbox relations, consumed attachments, optional pending outbound job, and completed idempotency response in one D1 batch. The unique constraint closes the race between the initial replay check and insertion. `requireIdempotentResult` verifies the request hash before returning the stored response. An immediate dispatch failure is safe to suppress because the durable pending job remains in D1.

### 10.9 Outbound dispatcher

```typescript
export class OutboundJobService {
  constructor(
    private readonly jobs: OutboundJobRepository,
    private readonly queue: OutboundQueue,
  ) {}

  async dispatch(jobId: string): Promise<void> {
    const job = await this.jobs.requireDispatchable(jobId);

    await this.queue.send({
      jobId: job.id,
      messageId: job.messageId,
    });

    await this.jobs.markEnqueued(job.id);
  }

  async dispatchPending(limit = 100): Promise<void> {
    const jobs = await this.jobs.listDispatchable(limit);
    for (const job of jobs) {
      await this.dispatch(job.id);
    }
  }
}
```

If queue submission succeeds but `markEnqueued` fails, the dispatcher may enqueue a duplicate. This is intentional: recovery favors at-least-once delivery, while the consumer claim prevents concurrent processing.

`requireDispatchable` returns only due `pending` jobs. `markEnqueued` is a compare-and-set from `pending` to `enqueued`; it must not overwrite a job that a fast consumer has already changed to `processing`.

### 10.10 Queue consumer

```typescript
export async function processOutboundJob(
  ctx: AppContext,
  job: OutboundMailJob,
): Promise<void> {
  const claim = await ctx.outboundJobs.claim(job.jobId, job.messageId);
  if (!claim.acquired) return;

  try {
    const message = await ctx.messages.requireForProvider(job.messageId);
    const plugin = ctx.providers.get(message.providerKey);
    const result = await plugin.outbound.send(
      message.providerContext,
      message.providerPayload,
    );

    await ctx.messages.markSent({
      messageId: message.id,
      providerKey: plugin.outbound.key,
      providerMessageId: result.providerMessageId,
      sentAt: result.acceptedAt,
    });

    await ctx.outboundJobs.complete(claim);
  } catch (error) {
    const safeError = toSafeProviderError(error);
    const failure = await ctx.outboundJobs.recordFailure(claim, safeError);

    if (!failure.retryable) {
      await ctx.messages.markFailed(job.messageId, safeError);
      return;
    }

    throw error;
  }
}
```

The claim uses a time-bounded lock and increments `attempts`. `recordFailure` clears the lock and either returns the job to `enqueued` for queue retry or marks it `failed` after the configured attempt limit. Provider adapters must pass `message.id` as the provider idempotency key when the provider supports one.

Exactly-once external delivery cannot be guaranteed when a provider lacks idempotency support: the Worker may terminate after provider acceptance but before D1 is updated. Use webhook reconciliation and provider-message synchronization to resolve that state, and expose it operationally rather than claiming exactly-once semantics.

### 10.11 Webhook status application

```typescript
export async function applyProviderEvent(
  ctx: AppContext,
  event: ProviderEvent,
): Promise<void> {
  const claim = await ctx.webhooks.claimDelivery(event);
  if (claim.completed) return;
  if (!claim.acquired) {
    throw new DomainError(
      "WEBHOOK_BUSY",
      "The webhook event is being processed",
      503,
    );
  }

  try {
    const message = await findOrImportProviderMessage(ctx, event);
    await ctx.messages.applyStatusIfNewer({
      messageId: message.id,
      providerConnectionId: event.connectionId,
      providerKey: event.providerKey,
      providerMessageId: event.providerMessageId,
      status: event.status,
      statusRank: statusRank[event.status],
      eventTime: event.occurredAt.getTime(),
      error: event.error,
    });
    await ctx.webhooks.recordEvent(event, message.id);
    await ctx.webhooks.completeDelivery(claim);
  } catch (error) {
    await ctx.webhooks.failDelivery(claim, toSafeProviderError(error));
    throw error;
  }
}
```

### 10.12 D1 repository transaction

D1 batch operations are transactional. A repository method must prepare all statements before execution:

```typescript
export async function createMessageGraph(
  db: D1Database,
  graph: NewMessageGraph,
): Promise<void> {
  const statements: D1PreparedStatement[] = [
    db.prepare(INSERT_MESSAGE).bind(...toMessageParams(graph.message)),
    ...graph.recipients.map((recipient) =>
      db.prepare(INSERT_RECIPIENT).bind(...toRecipientParams(recipient)),
    ),
    ...graph.mailboxMessages.map((link) =>
      db.prepare(INSERT_MAILBOX_MESSAGE).bind(...toMailboxMessageParams(link)),
    ),
    ...graph.attachments.map((attachment) =>
      db.prepare(INSERT_ATTACHMENT).bind(...toAttachmentParams(attachment)),
    ),
    ...(graph.outboundJob
      ? [
          db
            .prepare(INSERT_OUTBOUND_JOB)
            .bind(graph.outboundJob.id, graph.message.id),
        ]
      : []),
    ...(graph.idempotency
      ? [
          db
            .prepare(INSERT_IDEMPOTENCY_RECORD)
            .bind(...toIdempotencyParams(graph.idempotency)),
        ]
      : []),
  ];

  await db.batch(statements);
}
```

The attachment triggers abort and roll back the batch when any upload is invalid. Keep the maximum attachment count low enough that the complete graph fits within D1's statement and bind-parameter limits.

## 11. HTTP API

Base path:

```text
/api/v1
```

### 11.1 Authenticated configuration

| Method | Path                                    | Purpose                                      |
| ------ | --------------------------------------- | -------------------------------------------- |
| GET    | `/admin/cloudflare/status`              | Return independent configuration checkpoints |
| POST   | `/admin/cloudflare/oauth/start`         | Start Cloudflare OAuth                       |
| GET    | `/admin/cloudflare/oauth/callback`      | Complete Cloudflare OAuth                    |
| POST   | `/admin/cloudflare/oauth/revoke`        | Revoke and delete encrypted OAuth tokens     |
| POST   | `/admin/cloudflare/verify`              | Verify account, zone, and Email Routing      |
| POST   | `/admin/cloudflare/domains`             | Configure a managed Email Routing domain     |
| POST   | `/admin/cloudflare/smoke-test/inbound`  | Run the inbound smoke test                   |
| POST   | `/admin/cloudflare/brevo`               | Validate and store encrypted Brevo settings  |
| POST   | `/admin/cloudflare/smoke-test/outbound` | Run the outbound smoke test                  |
| GET    | `/admin/infrastructure`                 | Report required bindings and storage backend |
| POST   | `/admin/storage/r2/verify`              | Probe the optional R2 binding                |

All endpoints require authentication and `settings.manage`. The OAuth callback
is authorized by a one-time state value tied to the initiating administrator.

### 11.2 Authentication

| Method | Path                   | Purpose                                   |
| ------ | ---------------------- | ----------------------------------------- |
| POST   | `/auth/register`       | Register with an optional invitation key  |
| POST   | `/auth/login`          | Create access and refresh tokens          |
| POST   | `/auth/refresh`        | Rotate the refresh token                  |
| POST   | `/auth/logout`         | Revoke the active session                 |
| POST   | `/auth/logout-all`     | Revoke all user sessions                  |
| POST   | `/auth/password/reset` | Change password and revoke sessions       |
| POST   | `/auth/email`          | Change login identity and revoke sessions |

### 11.3 Mailboxes

| Method | Path                             | Required access        |
| ------ | -------------------------------- | ---------------------- |
| GET    | `/mailboxes`                     | Authenticated          |
| POST   | `/mailboxes`                     | `mailbox.create`       |
| GET    | `/mailboxes/:id`                 | Mailbox read           |
| PATCH  | `/mailboxes/:id`                 | Mailbox rename         |
| DELETE | `/mailboxes/:id`                 | Mailbox owner          |
| GET    | `/mailboxes/:id/members`         | Mailbox read           |
| POST   | `/mailboxes/:id/members`         | Manage members         |
| PATCH  | `/mailboxes/:id/members/:userId` | Manage members         |
| DELETE | `/mailboxes/:id/members/:userId` | Manage members or self |

### 11.4 Messages

| Method | Path                        | Required access                 |
| ------ | --------------------------- | ------------------------------- |
| GET    | `/mailboxes/:id/messages`   | Mailbox read                    |
| GET    | `/messages/:id`             | Read linked mailbox             |
| POST   | `/messages/send`            | `message.send` and mailbox send |
| PATCH  | `/messages/:id/read`        | Read linked mailbox             |
| PATCH  | `/messages/:id/star`        | Read linked mailbox             |
| DELETE | `/messages/:id`             | Delete linked mailbox message   |
| GET    | `/messages/:id/attachments` | Read linked mailbox             |

Draft mutations require the caller to be the draft creator:

| Method | Path               | Purpose                                |
| ------ | ------------------ | -------------------------------------- |
| POST   | `/drafts`          | Create a server draft                  |
| GET    | `/drafts`          | List the caller's drafts               |
| GET    | `/drafts/:id`      | Read one draft                         |
| PUT    | `/drafts/:id`      | Replace editable draft content         |
| DELETE | `/drafts/:id`      | Delete a draft                         |
| POST   | `/drafts/:id/send` | Atomically transition and send a draft |

`PUT /drafts/:id` and `POST /drafts/:id/send` require an `If-Match` value derived from `updated_at`. A stale value returns `409 DRAFT_VERSION_CONFLICT`.

`POST /messages/send` and `POST /drafts/:id/send` also require an `Idempotency-Key` header. Retain completed records for at least the maximum client retry window.

List pagination uses an opaque cursor:

```json
{
  "items": [],
  "nextCursor": "opaque-or-null"
}
```

The cursor encodes `(created_at, id)` and is signed to prevent modification.

### 11.5 Attachments

| Method | Path                                | Purpose                                   |
| ------ | ----------------------------------- | ----------------------------------------- |
| POST   | `/attachments/uploads`              | Create a direct-upload URL                |
| POST   | `/attachments/uploads/:id/complete` | Verify R2 metadata and complete an upload |
| DELETE | `/attachments/uploads/:id`          | Cancel an unused upload                   |
| GET    | `/attachments/:id/download`         | Authorized download                       |

Unused uploads expire and are removed by a scheduled cleanup job.

### 11.6 Administration

| Method                | Path                               | Permission                                     |
| --------------------- | ---------------------------------- | ---------------------------------------------- |
| GET/POST/PATCH/DELETE | `/admin/users`                     | `user.read` or `user.manage`                   |
| GET/POST/PATCH/DELETE | `/admin/roles`                     | `role.read` or `role.manage`                   |
| GET/POST/PATCH/DELETE | `/admin/domains`                   | `domain.read` or `domain.manage`               |
| GET/PATCH             | `/admin/settings`                  | `settings.read` or `settings.manage`           |
| GET/PUT               | `/admin/domains/:id/signature`     | `signature.read` or `signature.manage`         |
| POST                  | `/admin/domains/:id/provider-test` | `domain.manage`                                |
| GET                   | `/admin/providers`                 | `domain.read`                                  |
| GET/POST/PATCH        | `/admin/provider-connections`      | `domain.read` or `domain.manage`               |
| POST                  | `/admin/providers/sync`            | `provider.sync`                                |
| GET/DELETE            | `/admin/webhook-events`            | `webhook_event.read` or `webhook_event.delete` |

### 11.7 Provider webhooks

```text
POST /api/v1/webhooks/:providerKey/:connectionId
```

The route accepts only provider keys registered in the runtime (`brevo` and
`resend`). The opaque connection ID selects the encrypted verification secret;
it is not authentication by itself. Webhook routes do not use user
authentication, so provider-specific verification must succeed. Processing
also resolves a managed domain and stores it on delivery, provider-state, and
webhook audit records before acknowledging the event.

### 11.8 Response format

Success:

```json
{
  "data": {}
}
```

Failure:

```json
{
  "error": {
    "code": "MAILBOX_PERMISSION_DENIED",
    "message": "The operation is not permitted for this mailbox",
    "requestId": "request-uuid"
  }
}
```

## 12. Web application

### 12.1 Feature boundaries

```text
features/inbox/
├── api.ts
├── queries.ts
├── types.ts
├── components/
├── pages/
└── test/
```

Feature code imports API schemas from `packages/contracts`. It must not duplicate server enums.

### 12.2 Server and UI state

- TanStack Query owns server data and cache invalidation.
- Zustand owns transient UI state such as open compose windows and selected mailbox.
- D1 owns explicitly saved drafts.
- Dexie owns unsaved compose working copies and pending local attachment references; reconcile a working copy by server draft ID and `updatedAt`.
- Form state remains inside React Hook Form.
- URL search parameters own shareable filters and pagination state.

### 12.3 Required routes

```text
/login
/inbox/:mailboxId
/messages/:messageId
/sent/:mailboxId
/drafts
/starred
/settings
/settings/mailboxes
/settings/cloudflare
/settings/storage
/admin/users
/admin/roles
/admin/domains
/admin/signatures
/admin/settings
/admin/webhook-events
```

### 12.4 Compose state

```typescript
export interface ComposeDraft {
  id: string;
  mailboxId: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  html: string;
  text: string;
  parentMessageId?: string;
  includeSignature: boolean;
  attachments: Array<{
    attachmentId: string;
    filename: string;
    size: number;
    uploadState: "pending" | "uploading" | "ready" | "failed";
  }>;
  updatedAt: number;
}
```

Drafts are partitioned by authenticated user ID in IndexedDB.

## 13. Security requirements

- Use a strict production CORS allowlist.
- Use `Authorization: Bearer <token>`.
- Use the versioned Web Crypto PBKDF2 policy defined by the identity module; never use one fast hash.
- Store refresh-token hashes, not raw refresh tokens.
- Encrypt provider credentials with AES-GCM.
- Keep encryption, signing, and installation keys in Cloudflare Secrets Store bindings provisioned by the deployment flow.
- Verify webhook signatures before parsing or acting on payloads.
- Sanitize HTML signatures and rendered message content.
- Serve message HTML inside a sandboxed iframe.
- Do not log message bodies, credentials, tokens, or attachment bytes.
- Validate every request with shared runtime schemas.
- Authorize every object using its database relationship.
- Use signed cursors and signed object URLs.
- Enforce request, attachment, and recipient size limits.
- Rate-limit login, registration, presign, send, and webhook endpoints.
- Add idempotency keys to compose and administrator mutation APIs.

## 14. Observability

Every log event is a single JSON object:

```typescript
logger.info({
  event: "outbound.send.completed",
  requestId,
  messageId,
  mailboxId,
  providerKey,
  providerMessageId,
  durationMs,
});
```

Required metrics:

- API request count, latency, and error rate
- Authentication failures and rate-limit rejections
- Inbound messages accepted, rejected, and failed
- Outbound queue depth and retry count
- Provider send latency and failure rate
- Webhook duplicates, failures, and lock contention
- Provider synchronization inserted, updated, skipped, and failed counts
- Missing R2 objects and unused-upload cleanup count

## 15. Scheduled jobs

| Job                        | Frequency                  | Responsibility                                                  |
| -------------------------- | -------------------------- | --------------------------------------------------------------- |
| Outbound dispatch recovery | Every minute               | Enqueue due `pending` jobs and recover expired processing locks |
| Maintenance backfills      | Every minute while pending | Process bounded migration batches and persist cursors           |
| Session cleanup            | Daily                      | Delete expired or revoked sessions                              |
| Idempotency cleanup        | Daily                      | Delete expired completed command records                        |
| Upload cleanup             | Hourly                     | Delete expired unused R2 uploads                                |
| Webhook cleanup            | Daily                      | Delete webhook audit and delivery records beyond retention      |
| Orphan-object cleanup      | Daily                      | Delete R2 objects with no attachment or raw-message reference   |
| Message retention          | Daily                      | Remove expired trash and unreferenced canonical messages        |
| Analytics aggregation      | Hourly or daily            | Precompute administrative metrics                               |

Scheduled jobs must be idempotent and cursor-based.

## 16. Operational scaffolding

### 16.1 Scaffold contract

The repository ships one cross-platform Node.js CLI behind `pnpm scaffold`. It wraps project initialization, validation, migrations, release, and deployment verification; contributors must not need to assemble raw Wrangler commands.

```text
pnpm scaffold init
pnpm scaffold doctor
pnpm db:migration:new <name>
pnpm db:migration:status --target local|preview|production
pnpm db:migrate --target local|preview
pnpm db:migrate --target production --confirm <deployment-id>
pnpm db:verify --target local|preview|production
pnpm release:preview
pnpm release:production
pnpm release:verify <deployment-url>
```

Responsibilities:

- `init` validates the pinned Node, pnpm, and Wrangler versions; creates local persistence directories; and applies migrations to an empty local D1 database.
- `doctor` checks binding declarations, generated types, migration order, schema drift, required package scripts, and Cloudflare deployment metadata.
- `migration:new` creates the next immutable, zero-padded SQL migration and a paired verification fixture.
- `db:migrate` resolves the declared D1 binding and refuses an unknown target, dirty migration directory, checksum mismatch, or production execution without explicit confirmation.
- `db:verify` checks the recorded migration list, required tables and indexes, `PRAGMA foreign_key_check`, installation schema version, and application health query.
- Release commands build once, retain an artifact manifest, and deploy that exact artifact.

The CLI must use structured output and stable exit codes so both humans and CI can call the same implementation.

### 16.2 Migration policy

Use one migration authority:

- Drizzle owns typed schema declarations and may generate SQL.
- Reviewed SQL files in `migrations/` are the deployable artifacts.
- Wrangler applies migrations and records them in `d1_migrations`.
- The scaffold records repository checksums and rejects edits to an already released migration.

Every migration must contain:

```text
migrations/NNNN_short_name.sql
migrations/meta/NNNN_short_name.verify.sql
migrations/meta/NNNN_short_name.md
```

The metadata document states purpose, compatibility window, expected duration, data-backfill strategy, verification queries, and recovery procedure.

Rules:

- Prefer expand-and-contract changes.
- Release additive columns and tables before code that writes them.
- Backfill in bounded, resumable `maintenance_jobs` rather than one unbounded migration.
- A backfill migration inserts a stable `job_key`; a code-side handler registry processes that key in limited batches and persists `cursor_json`.
- CI fails when a pending backfill key has no registered handler or a handler has no idempotency test.
- Remove old reads before removing old columns.
- Destructive changes require a separate later release and explicit operator approval.
- Test both an empty database and an upgrade fixture representing the last production schema.
- Never auto-restore production on migration failure.
- Record a D1 Time Travel bookmark immediately before production migration. Application rollback uses a previous Worker version; database restoration is a separately approved incident action.

Use the binding name for deployment-template migrations so user-selected database names remain valid. See the [D1 migration documentation](https://developers.cloudflare.com/d1/reference/migrations/) and [D1 Time Travel documentation](https://developers.cloudflare.com/d1/reference/time-travel/).

### 16.3 CI pipeline

Every pull request runs:

1. Frozen dependency installation.
2. Generated-file and schema-drift checks.
3. Formatting, linting, and TypeScript checks.
4. Unit and Worker tests.
5. All migrations against an empty local D1 database.
6. Upgrade migrations against the previous-release fixture.
7. Foreign-key and migration verification queries.
8. Production build and Wrangler dry run.
9. Preview-version upload and smoke tests when Cloudflare credentials are available.

The required checks block merging. CI has read-only or preview-scoped Cloudflare access and cannot deploy production.

### 16.4 CD pipeline

Workers Builds is the default delivery system:

```text
Pull request
  -> verify
  -> upload preview version
  -> run preview smoke tests

Production branch
  -> verify again
  -> capture D1 bookmark
  -> apply reviewed production migrations
  -> verify schema and backward compatibility
  -> upload Worker version
  -> run setup-safe and application smoke tests
  -> promote version
  -> verify queue, cron, inbound route, and Brevo health
```

Production rules:

- Only the protected production branch may run `release:production`.
- Use one concurrency lock per Cloudflare account and Worker.
- Migration and deployment logs include commit SHA, artifact digest, migration list, D1 bookmark, Worker version, actor, and timestamps.
- A failed migration stops deployment.
- A failed pre-promotion smoke test leaves the existing deployment active.
- A failed post-promotion smoke test rolls back the Worker version; database recovery follows the migration's documented procedure.
- Preview deployments never point at production D1, R2, KV, Queues, Brevo credentials, or Email Routing rules.

Cloudflare Workers Builds supports Git-connected production and preview builds; non-production branches should upload preview versions rather than promote them. See the [Workers Builds documentation](https://developers.cloudflare.com/workers/ci-cd/builds/) and [build configuration documentation](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/).

## 17. Testing requirements

Required commands:

```text
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:worker
pnpm test:integration
pnpm test:e2e
pnpm scaffold doctor
pnpm db:verify --target local
pnpm build
pnpm deploy:dry-run
```

Critical test suites:

- Password hashing, refresh rotation, and session revocation
- Global permission matrix
- Mailbox role matrix
- Recipient normalization
- Signature sanitization and reply placement
- RFC threading headers
- Direct-upload signing and object validation
- Inbound MIME parsing with binary and multibyte content
- Internal, external, and mixed recipient delivery
- Provider registry contract with an unregistered provider
- Brevo payload mapping, error classification, and health check
- Brevo webhook verification
- Duplicate webhook delivery
- Concurrent provider-message import
- Out-of-order status events
- Queue retry and send idempotency
- Message and attachment authorization
- Cursor pagination stability
- Fresh D1 migration
- Previous-release D1 upgrade
- Setup state-machine resume, repair, and takeover prevention
- Cloudflare dashboard-assisted and OAuth callback flows

## 18. Phased implementation plan

Each phase is independently deployable. A phase starts only after the previous phase's exit criteria pass in CI and a preview deployment. Later-phase abstractions may be defined early, but later behavior must not delay the current usable slice.

### Phase 0 — Deployable foundation

Deliver:

- Workspace, Worker entrypoints, React shell, shared contracts, and structured errors
- Deploy to Cloudflare button and automatic binding declarations
- Setup claim, preflight, first-administrator flow, and installation route guard
- Initial schema, seed migration, migration CLI, CI checks, preview deployment, and health endpoint

Exit criteria:

- A new Cloudflare account can deploy without editing account IDs or `.env`.
- The setup page identifies missing bindings or migrations precisely.
- Fresh and previous-fixture migrations pass automatically.

### Phase 1 — Basic inbound mailbox

Deliver:

- Login, refresh rotation, administrator/member roles
- Cloudflare dashboard-assisted Email Routing setup
- Managed domain and mailbox creation
- Inbound MIME parsing and canonical message storage
- Inbox list, message detail, read state, and basic deletion
- Minimal operational logs and inbound smoke test

Defer mailbox sharing, attachments, drafts, rich compose, and provider synchronization.

Exit criteria:

- An administrator completes setup, creates a mailbox, receives a real message, and reads it in the web client.
- Unauthorized users cannot access the mailbox or attachment metadata.

### Phase 2 — Basic Brevo outbound

Deliver:

- Provider plugin contracts and registry
- Brevo connection step, encrypted credentials, and health check
- Plain-text and HTML compose with TO, CC, and BCC
- Durable outbound job, Queue consumer, retries, and idempotency
- Brevo webhook verification and core status mapping
- Outbound setup smoke test

Defer additional providers, provider import, bulk administration, and advanced composition.

Exit criteria:

- Internal-only, external-only, and mixed-recipient messages pass integration tests.
- A real Brevo send reaches `sent` and a verified webhook can advance its status.
- No application use case imports Brevo-specific code.

### Phase 3 — Complete mailbox workflow

Deliver:

- R2 direct upload and authorized download
- Server drafts with optimistic concurrency
- Reply threading, signatures, quoted content, and inline attachments
- Shared mailboxes and member roles
- Stars, sent, drafts, archive, and trash views
- Browser crash-recovery working copies

Exit criteria:

- Critical compose, attachment, draft, reply, and sharing journeys pass Playwright.
- Attachment authorization and upload-consumption race tests pass.

### Phase 4 — Administration and operations

Deliver:

- Provider message synchronization and reconciliation
- User, role, domain, connection, settings, and webhook administration
- Audit search, metrics, scheduled cleanup, retention, and rate-limit tuning
- Production release verification, alerts, runbooks, and recovery exercises
- Optional Cloudflare OAuth setup mode

Exit criteria:

- Operators can diagnose and recover failed migrations, sends, webhooks, and setup steps using documented commands.
- Production deployment and Worker rollback drills pass without unplanned data loss.

### Phase 5 — Additional providers

Do not start this phase until Brevo behavior and provider contracts are stable.

For each new provider:

1. Implement a plugin outside the message modules.
2. Add its connection form and schema.
3. Add provider contract and event-mapping tests.
4. Register it in the composition root.
5. Prove that the message schema, send use case, API routes, and queue consumer require no provider-specific branch.

The first production milestone is Phase 1. The first outbound-capable milestone is Phase 2.
