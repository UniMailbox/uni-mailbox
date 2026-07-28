import { RuntimeConfigSchema, type RuntimeConfig } from "@unimailbox/config";

export interface SecretStoreBinding {
  get(): Promise<string>;
}

export type SecretBinding = string | SecretStoreBinding;

export interface OutboundMailJob {
  kind?: "outbound";
  jobId: string;
  messageId: string;
}

export interface OrphanObjectCleanupJob {
  kind: "orphan_object_cleanup";
  jobId: string;
  objectKeys: string[];
}

export type UniMailboxQueueJob = OutboundMailJob | OrphanObjectCleanupJob;

export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  /**
   * Optional R2 binding. When present, raw messages and attachment bytes are
   * stored in R2; otherwise the KV-backed default backend is used. The runtime
   * picks the backend automatically based on binding presence — see
   * `apps/worker/src/platform/attachment-store.ts`.
   */
  ATTACHMENTS?: R2Bucket;
  OUTBOUND_QUEUE: Queue<UniMailboxQueueJob>;
  ASSETS: Fetcher;
  INSTALLATION_TOKEN: SecretBinding;
  AUTH_SIGNING_KEY: SecretBinding;
  CREDENTIAL_ENCRYPTION_KEY: SecretBinding;
  CLOUDFLARE_OAUTH_CLIENT_ID?: SecretBinding;
  CLOUDFLARE_OAUTH_CLIENT_SECRET?: SecretBinding;
  CLOUDFLARE_OAUTH_SCOPES?: string;
}

export async function readSecretBinding(
  binding: SecretBinding,
): Promise<string> {
  return typeof binding === "string" ? binding : binding.get();
}

export async function resolveRuntimeConfig(env: Env): Promise<RuntimeConfig> {
  return RuntimeConfigSchema.parse({
    INSTALLATION_TOKEN: await readSecretBinding(env.INSTALLATION_TOKEN),
    AUTH_SIGNING_KEY: await readSecretBinding(env.AUTH_SIGNING_KEY),
    CREDENTIAL_ENCRYPTION_KEY: await readSecretBinding(
      env.CREDENTIAL_ENCRYPTION_KEY,
    ),
    ALLOWED_ORIGINS: [],
  });
}
