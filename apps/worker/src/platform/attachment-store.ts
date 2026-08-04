import { DomainError } from "@unimailbox/contracts";
import type { Env } from "./config";

/**
 * Hard upper bound for a single attachment object on the KV backend.
 * Cloudflare KV rejects values that reach 25 MiB; we cap a step below so
 * callers can distinguish our explicit rejection from KV's own 400 response.
 */
export const KV_VALUE_LIMIT = 25 * 1024 * 1024;

export type StorageBackend = "r2" | "kv";

export interface AttachmentHttpMetadata {
  contentType?: string;
  contentDisposition?: string;
  contentLanguage?: string;
  contentEncoding?: string;
  cacheControl?: string;
}

export interface AttachmentMetadata {
  /**
   * Optional explicit size hint. R2 ignores it (R2 measures the body on
   * write); the KV-backed store always derives the size from the body
   * because KV's `put` has no separate length argument.
   */
  size?: number;
  httpMetadata?: AttachmentHttpMetadata;
  customMetadata?: Record<string, string>;
}

export interface AttachmentObject {
  body: ReadableStream | ArrayBuffer | Uint8Array;
  size: number;
  httpMetadata: AttachmentHttpMetadata;
  customMetadata: Record<string, string>;
  etag?: string;
}

export interface AttachmentListOptions {
  prefix?: string;
  limit?: number;
  cursor?: string;
}

export interface AttachmentListEntry {
  key: string;
  size: number;
  uploadedAt?: Date;
}

export interface AttachmentListPage {
  objects: AttachmentListEntry[];
  truncated: boolean;
  cursor?: string;
}

export interface AttachmentStore {
  readonly backend: StorageBackend;
  put(
    key: string,
    body: ArrayBuffer | Uint8Array | Blob | ReadableStream,
    meta: AttachmentMetadata,
  ): Promise<void>;
  get(key: string): Promise<AttachmentObject | null>;
  head(key: string): Promise<AttachmentObject | null>;
  delete(key: string): Promise<void>;
  list(options?: AttachmentListOptions): Promise<AttachmentListPage>;
}

export interface StorageBackendInfo {
  backend: StorageBackend;
  reason: string;
  maxObjectBytes: number;
}

async function toUint8Array(
  body: ArrayBuffer | Uint8Array | Blob | ReadableStream,
): Promise<Uint8Array> {
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
    }
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

export class R2AttachmentStore implements AttachmentStore {
  readonly backend: StorageBackend = "r2";

  constructor(private readonly bucket: R2Bucket) {}

  async put(
    key: string,
    body: ArrayBuffer | Uint8Array | Blob | ReadableStream,
    meta: AttachmentMetadata,
  ): Promise<void> {
    await this.bucket.put(key, body, {
      httpMetadata: meta.httpMetadata,
      customMetadata: meta.customMetadata,
    });
  }

  async get(key: string): Promise<AttachmentObject | null> {
    const object = await this.bucket.get(key);
    if (!object) return null;
    return {
      body: object.body,
      size: object.size,
      httpMetadata: {
        contentType: object.httpMetadata?.contentType,
        contentDisposition: object.httpMetadata?.contentDisposition,
        contentLanguage: object.httpMetadata?.contentLanguage,
        contentEncoding: object.httpMetadata?.contentEncoding,
        cacheControl: object.httpMetadata?.cacheControl,
      },
      customMetadata: object.customMetadata ?? {},
      etag: object.httpEtag,
    };
  }

  async head(key: string): Promise<AttachmentObject | null> {
    const object = await this.bucket.head(key);
    if (!object) return null;
    return {
      body: new Uint8Array(),
      size: object.size,
      httpMetadata: {
        contentType: object.httpMetadata?.contentType,
        contentDisposition: object.httpMetadata?.contentDisposition,
        contentLanguage: object.httpMetadata?.contentLanguage,
        contentEncoding: object.httpMetadata?.contentEncoding,
        cacheControl: object.httpMetadata?.cacheControl,
      },
      customMetadata: object.customMetadata ?? {},
      etag: object.httpEtag,
    };
  }

  async delete(key: string): Promise<void> {
    await this.bucket.delete(key);
  }

  async list(options: AttachmentListOptions = {}): Promise<AttachmentListPage> {
    const page = await this.bucket.list({
      prefix: options.prefix,
      limit: Math.min(options.limit ?? 100, 1000),
      ...(options.cursor ? { cursor: options.cursor } : {}),
    });
    return {
      objects: page.objects.map((object) => ({
        key: object.key,
        size: object.size,
        uploadedAt: object.uploaded,
      })),
      truncated: page.truncated,
      cursor: page.truncated ? page.cursor : undefined,
    };
  }
}

// KV caps user-supplied metadata at 1024 bytes; httpMetadata + a long
// filename can blow past that, so the *body* KV value carries the full
// record while the *user* KV metadata keeps a compact "overflow" marker
// plus the orphan-sweep timestamp that lives next to it. Legacy objects
// written before the single-key migration (body + sidecar meta key) are
// still readable through the same code path.
const BODY_PREFIX = "attachment:";
const LEGACY_META_PREFIX = "attachment-meta:";

interface StoredMetadata {
  size: number;
  httpMetadata?: AttachmentHttpMetadata;
  customMetadata?: Record<string, string>;
}

interface KvUserMetadata {
  uploadedAt: string;
  // When the full StoredMetadata does not fit in the 1024-byte KV metadata
  // cap, we write an `overflow: "1"` flag and store the original record
  // in a sidecar key. Reads detect the flag and fall through to the
  // sidecar; the body key never depends on the sidecar existing.
  overflow?: "1";
}

const KV_USER_METADATA_LIMIT = 1024;
const OVERFLOW_MARKER = { uploadedAt: "", overflow: "1" as const };

function serializeMeta(meta: StoredMetadata): string {
  return JSON.stringify(meta);
}

function parseMeta(raw: string): StoredMetadata {
  try {
    const parsed = JSON.parse(raw) as StoredMetadata;
    return {
      size: typeof parsed.size === "number" ? parsed.size : 0,
      httpMetadata: parsed.httpMetadata,
      customMetadata: parsed.customMetadata,
    };
  } catch {
    return { size: 0 };
  }
}

/**
 * Try to encode `meta` plus an upload timestamp into the 1024-byte KV user
 * metadata slot. Returns the encoded record and either a `null` overflow
 * flag (fits) or `"1"` (overflows — caller must write a sidecar meta key).
 */
function tryEncodeKvMetadata(
  meta: StoredMetadata,
  uploadedAt: string,
): { encoded: KvUserMetadata; overflowed: "1" | null } {
  const compact: KvUserMetadata = { uploadedAt };
  if (JSON.stringify(compact).length > KV_USER_METADATA_LIMIT) {
    // uploadedAt alone is ~30 bytes; this branch is defensive.
    return { encoded: OVERFLOW_MARKER, overflowed: "1" };
  }
  const merged: StoredMetadata & { uploadedAt: string } = {
    uploadedAt,
    ...meta,
  };
  const mergedJson = JSON.stringify(merged);
  if (mergedJson.length <= KV_USER_METADATA_LIMIT) {
    return { encoded: merged as unknown as KvUserMetadata, overflowed: null };
  }
  // The body keeps the canonical record; the metadata slot only carries
  // the timestamp and an overflow flag pointing readers at the sidecar.
  return { encoded: OVERFLOW_MARKER, overflowed: "1" };
}

export class KvAttachmentStore implements AttachmentStore {
  readonly backend: StorageBackend = "kv";

  constructor(private readonly kv: KVNamespace) {}

  async put(
    key: string,
    body: ArrayBuffer | Uint8Array | Blob | ReadableStream,
    meta: AttachmentMetadata,
  ): Promise<void> {
    const bytes = await toUint8Array(body);
    if (bytes.byteLength >= KV_VALUE_LIMIT) {
      throw new DomainError(
        "ATTACHMENT_TOO_LARGE",
        `Attachments larger than ${KV_VALUE_LIMIT - 1} bytes are not supported on the KV backend`,
        413,
        { limit: KV_VALUE_LIMIT - 1, backend: "kv" },
      );
    }
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    const stored: StoredMetadata = {
      size: bytes.byteLength,
      httpMetadata: meta.httpMetadata,
      customMetadata: meta.customMetadata,
    };
    const uploadedAt = new Date().toISOString();
    const { encoded, overflowed } = tryEncodeKvMetadata(stored, uploadedAt);
    const writes: Promise<unknown>[] = [
      this.kv.put(BODY_PREFIX + key, buffer, { metadata: encoded }),
    ];
    if (overflowed) {
      writes.push(this.kv.put(LEGACY_META_PREFIX + key, serializeMeta(stored)));
    }
    // A leftover sidecar from before the migration must not shadow the new
    // single-key write. Cheap; we only touch the body namespace otherwise.
    await Promise.all(writes);
  }

  private async readWithMeta(
    key: string,
  ): Promise<{ body: ArrayBuffer; meta: StoredMetadata } | null> {
    // Single getWithMetadata call: the body value comes back, the metadata
    // slot comes back, and no second round-trip is needed. The legacy
    // sidecar is only consulted when the metadata slot does not carry the
    // record (overflow path or pre-migration object).
    const kvKey = BODY_PREFIX + key;
    const withMeta = await this.kv.getWithMetadata(kvKey, "arrayBuffer");
    if (!withMeta || withMeta.value === null) return null;
    const body = withMeta.value as ArrayBuffer;
    const fromMeta = decodeKvMetadata(
      withMeta.metadata as Partial<KvUserMetadata & StoredMetadata> | null,
    );
    if (fromMeta) {
      return { body, meta: fromMeta };
    }
    const sidecar = await this.kv.get(LEGACY_META_PREFIX + key);
    if (sidecar !== null) {
      return { body, meta: parseMeta(sidecar) };
    }
    // Last-ditch fallback: no metadata anywhere — derive size from the body.
    return { body, meta: { size: body.byteLength } };
  }

  async get(key: string): Promise<AttachmentObject | null> {
    const fetched = await this.readWithMeta(key);
    if (!fetched) return null;
    const { body, meta } = fetched;
    return {
      body,
      size: meta.size || body.byteLength,
      httpMetadata: meta.httpMetadata ?? {},
      customMetadata: meta.customMetadata ?? {},
    };
  }

  async head(key: string): Promise<AttachmentObject | null> {
    // The old implementation downloaded the entire body to answer a HEAD.
    // `getWithMetadata` already returns the body, so the cheap "head"
    // path was not actually cheap. We keep a thin body stub for callers
    // that always read it (the only consumer is `complete()`, which only
    // touches `.size`) and let everything else ignore it.
    const fetched = await this.readWithMeta(key);
    if (!fetched) return null;
    const { body, meta } = fetched;
    return {
      body: new Uint8Array(0),
      size: meta.size || body.byteLength,
      httpMetadata: meta.httpMetadata ?? {},
      customMetadata: meta.customMetadata ?? {},
    };
  }

  async delete(key: string): Promise<void> {
    // Best-effort: even if the sidecar does not exist, the delete is a
    // no-op. A stale sidecar from a pre-migration object would otherwise
    // linger forever.
    await Promise.all([
      this.kv.delete(BODY_PREFIX + key),
      this.kv.delete(LEGACY_META_PREFIX + key),
    ]);
  }

  async list(options: AttachmentListOptions = {}): Promise<AttachmentListPage> {
    const prefix = BODY_PREFIX + (options.prefix ?? "");
    const page = await this.kv.list({
      prefix,
      limit: Math.min(options.limit ?? 100, 1000),
      ...(options.cursor ? { cursor: options.cursor } : {}),
    });
    const cursor = (page as { cursor?: string }).cursor;
    return {
      objects: page.keys.map((k) => {
        const meta = k.metadata as
          | (Partial<KvUserMetadata> & Partial<StoredMetadata>)
          | null
          | undefined;
        const uploadedAt =
          meta && typeof meta.uploadedAt === "string"
            ? meta.uploadedAt
            : undefined;
        const size = typeof meta?.size === "number" ? meta.size : 0;
        return {
          key: k.name.slice(BODY_PREFIX.length),
          size,
          ...(uploadedAt ? { uploadedAt: new Date(uploadedAt) } : {}),
        };
      }),
      truncated: !page.list_complete,
      cursor: page.list_complete ? undefined : cursor,
    };
  }
}

function decodeKvMetadata(
  raw: Partial<KvUserMetadata & StoredMetadata> | null,
): StoredMetadata | null {
  if (!raw) return null;
  // Overflow flag: the metadata slot is just a pointer; the real record
  // lives in the sidecar key, which the caller will fetch next.
  if (raw.overflow === "1") return null;
  if (typeof raw.size === "number") {
    return {
      size: raw.size,
      httpMetadata: raw.httpMetadata,
      customMetadata: raw.customMetadata,
    };
  }
  // Legacy object whose metadata only carries `uploadedAt`: we still
  // need the sidecar for the size/http headers, so bail out.
  if (typeof raw.uploadedAt === "string") return null;
  return null;
}

// Composite used while attachments migrate from KV to R2. Reads prefer R2
// and transparently fall back to KV when the R2 object is missing, which is
// what lets us run the two stores side-by-side during a cutover. Writes
// still go straight to R2; the legacy KV copy is removed on delete.
class R2WithKvFallbackAttachmentStore implements AttachmentStore {
  readonly backend: StorageBackend = "r2";

  constructor(
    private readonly primary: R2AttachmentStore,
    private readonly fallback: KvAttachmentStore,
  ) {}

  put(
    key: string,
    body: ArrayBuffer | Uint8Array | Blob | ReadableStream,
    meta: AttachmentMetadata,
  ): Promise<void> {
    return this.primary.put(key, body, meta);
  }

  async get(key: string): Promise<AttachmentObject | null> {
    return (await this.primary.get(key)) ?? this.fallback.get(key);
  }

  async head(key: string): Promise<AttachmentObject | null> {
    return (await this.primary.head(key)) ?? this.fallback.head(key);
  }

  async delete(key: string): Promise<void> {
    await Promise.all([this.primary.delete(key), this.fallback.delete(key)]);
  }

  list(options: AttachmentListOptions = {}): Promise<AttachmentListPage> {
    return this.primary.list(options);
  }
}

export function createAttachmentStore(env: Env): AttachmentStore {
  if (env.ATTACHMENTS) {
    return new R2WithKvFallbackAttachmentStore(
      new R2AttachmentStore(env.ATTACHMENTS),
      new KvAttachmentStore(env.KV),
    );
  }
  return new KvAttachmentStore(env.KV);
}

export function detectStorageBackend(env: Env): StorageBackendInfo {
  if (env.ATTACHMENTS) {
    return {
      backend: "r2",
      reason: "ATTACHMENTS binding is present in the Worker env",
      maxObjectBytes: 5 * 1024 * 1024 * 1024 * 1024,
    };
  }
  return {
    backend: "kv",
    reason: "ATTACHMENTS binding is absent; KV is the default storage backend",
    maxObjectBytes: KV_VALUE_LIMIT - 1,
  };
}
