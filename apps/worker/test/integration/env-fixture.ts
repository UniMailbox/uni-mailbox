import { env } from "cloudflare:test";
import {
  createAttachmentStore,
  detectStorageBackend,
  type AttachmentStore,
} from "../../src/platform/attachment-store";
import type { Env } from "../../src/platform/config";

/**
 * Build an Env for integration tests. By default we re-use the worker test
 * pool's bindings (which provide both KV and R2). Pass `withoutR2: true` to
 * simulate the default production deployment that omits R2 — the attachment
 * store will then pick the KV backend.
 */
export function makeEnv(options: { withoutR2?: boolean } = {}): Env {
  const envRecord = env as unknown as Record<string, unknown>;
  const base: Env = {
    DB: env.DB,
    KV: env.KV,
    OUTBOUND_QUEUE: env.OUTBOUND_QUEUE,
    ASSETS: {} as Fetcher,
    INSTALLATION_TOKEN: "x".repeat(32),
    AUTH_SIGNING_KEY: "x".repeat(32),
    CREDENTIAL_ENCRYPTION_KEY: "e".repeat(32),
  };
  if (!options.withoutR2 && envRecord.ATTACHMENTS) {
    base.ATTACHMENTS = envRecord.ATTACHMENTS as R2Bucket;
  }
  return base;
}

export function makeAttachmentStore(
  options: { withoutR2?: boolean } = {},
): AttachmentStore {
  return createAttachmentStore(makeEnv(options));
}

export function makeStorageBackend() {
  return detectStorageBackend(makeEnv()).backend;
}
