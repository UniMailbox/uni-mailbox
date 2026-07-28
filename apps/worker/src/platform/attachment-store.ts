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

const BODY_PREFIX = "attachment:";
const META_PREFIX = "attachment-meta:";

interface StoredMetadata {
  size: number;
  httpMetadata?: AttachmentHttpMetadata;
  customMetadata?: Record<string, string>;
}

interface KvBodyMetadata {
  uploadedAt?: string;
}

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
    await Promise.all([
      this.kv.put(BODY_PREFIX + key, buffer, {
        metadata: {
          uploadedAt: new Date().toISOString(),
        } satisfies KvBodyMetadata,
      }),
      this.kv.put(META_PREFIX + key, serializeMeta(stored)),
    ]);
  }

  async get(key: string): Promise<AttachmentObject | null> {
    const [body, metaRaw] = await Promise.all([
      this.kv.get(BODY_PREFIX + key, "arrayBuffer"),
      this.kv.get(META_PREFIX + key),
    ]);
    if (!body) return null;
    const meta = metaRaw ? parseMeta(metaRaw) : { size: body.byteLength };
    return {
      body,
      size: meta.size || body.byteLength,
      httpMetadata: meta.httpMetadata ?? {},
      customMetadata: meta.customMetadata ?? {},
    };
  }

  async head(key: string): Promise<AttachmentObject | null> {
    const [body, metaRaw] = await Promise.all([
      this.kv.get(BODY_PREFIX + key, "arrayBuffer"),
      this.kv.get(META_PREFIX + key),
    ]);
    if (!body) return null;
    const meta = metaRaw ? parseMeta(metaRaw) : { size: body.byteLength };
    return {
      body,
      size: meta.size || body.byteLength,
      httpMetadata: meta.httpMetadata ?? {},
      customMetadata: meta.customMetadata ?? {},
    };
  }

  async delete(key: string): Promise<void> {
    await Promise.all([
      this.kv.delete(BODY_PREFIX + key),
      this.kv.delete(META_PREFIX + key),
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
      objects: page.keys.map((k) => ({
        key: k.name.slice(BODY_PREFIX.length),
        size: 0,
        uploadedAt:
          typeof (k.metadata as KvBodyMetadata | undefined)?.uploadedAt ===
          "string"
            ? new Date((k.metadata as KvBodyMetadata).uploadedAt as string)
            : undefined,
      })),
      truncated: !page.list_complete,
      cursor: page.list_complete ? undefined : cursor,
    };
  }
}

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
