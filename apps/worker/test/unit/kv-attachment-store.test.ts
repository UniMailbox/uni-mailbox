import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  KV_VALUE_LIMIT,
  KvAttachmentStore,
  createAttachmentStore,
  detectStorageBackend,
  type AttachmentListEntry,
} from "../../src/platform/attachment-store";
import type { Env } from "../../src/platform/config";

function createMemoryKV(): KVNamespace {
  const store = new Map<
    string,
    { value: string | ArrayBuffer; meta?: unknown }
  >();
  return {
    async get(
      key: string,
      typeOrOptions?: "text" | "arrayBuffer" | "json" | "stream",
    ) {
      const entry = store.get(key);
      if (!entry) return null;
      if (typeOrOptions === "arrayBuffer") {
        if (typeof entry.value === "string") {
          return new TextEncoder().encode(entry.value).buffer;
        }
        return entry.value;
      }
      if (typeof entry.value === "string") return entry.value;
      return null;
    },
    async put(
      key: string,
      value: string | ArrayBuffer | ReadableStream,
      opts?: KVNamespacePutOptions,
    ) {
      if (value instanceof ArrayBuffer) {
        store.set(key, { value: value.slice(0), meta: opts?.metadata });
      } else if (typeof value === "string") {
        store.set(key, { value, meta: opts?.metadata });
      } else {
        // ReadableStream — drain into an ArrayBuffer.
        const reader = (value as ReadableStream<Uint8Array>).getReader();
        const chunks: Uint8Array[] = [];
        let total = 0;
        while (true) {
          const { value: chunk, done } = await reader.read();
          if (done) break;
          if (chunk) {
            chunks.push(chunk);
            total += chunk.byteLength;
          }
        }
        const merged = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          merged.set(chunk, offset);
          offset += chunk.byteLength;
        }
        store.set(key, { value: merged.buffer, meta: opts?.metadata });
      }
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list(
      options: KVNamespaceListOptions = {},
    ): Promise<KVNamespaceListResult<unknown>> {
      const prefix = options.prefix ?? "";
      const limit = options.limit ?? 1000;
      const cursor = options.cursor;
      const keys = [...store.keys()]
        .filter((key) => key.startsWith(prefix))
        .slice(0, limit)
        .map((name) => ({ name, metadata: store.get(name)?.meta }));
      const listComplete: boolean = keys.length < limit && !cursor;
      const result = {
        keys,
        list_complete: listComplete,
        cacheStatus: null,
        ...(cursor ? { cursor } : {}),
      };
      return result as unknown as KVNamespaceListResult<unknown>;
    },
    async getWithMetadata(
      key: string,
      typeOrOptions?: "text" | "arrayBuffer" | "json" | "stream",
    ) {
      const entry = store.get(key);
      if (!entry) {
        return { value: null, metadata: null };
      }
      if (typeOrOptions === "arrayBuffer") {
        if (typeof entry.value === "string") {
          return {
            value: new TextEncoder().encode(entry.value).buffer,
            metadata: entry.meta ?? null,
          };
        }
        return { value: entry.value, metadata: entry.meta ?? null };
      }
      return {
        value: typeof entry.value === "string" ? entry.value : null,
        metadata: entry.meta ?? null,
      };
    },
  } as unknown as KVNamespace;
}

describe("KvAttachmentStore", () => {
  let kv: KVNamespace;
  let store: KvAttachmentStore;

  beforeEach(() => {
    kv = createMemoryKV();
    store = new KvAttachmentStore(kv);
  });

  it("round-trips put, get, and delete", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    await store.put("attachments/abc", bytes, {
      httpMetadata: { contentType: "text/plain" },
      customMetadata: { uploadId: "upload-1" },
    });
    const fetched = await store.get("attachments/abc");
    expect(fetched).not.toBeNull();
    expect(fetched?.size).toBe(5);
    expect(fetched?.httpMetadata.contentType).toBe("text/plain");
    expect(fetched?.customMetadata.uploadId).toBe("upload-1");
    const bytes2 = fetched!.body as ArrayBuffer;
    expect(Array.from(new Uint8Array(bytes2))).toEqual([1, 2, 3, 4, 5]);
    await store.delete("attachments/abc");
    expect(await store.get("attachments/abc")).toBeNull();
    expect(await store.head("attachments/abc")).toBeNull();
  });

  it("exposes size and sidecar metadata via head", async () => {
    await store.put("attachments/x", new Uint8Array([9, 9, 9]), {
      customMetadata: { tag: "secret" },
    });
    const head = await store.head("attachments/x");
    expect(head?.size).toBe(3);
    expect(head?.customMetadata).toEqual({ tag: "secret" });
  });

  it("rejects writes at or above the KV single-value limit", async () => {
    const oversized = new Uint8Array(KV_VALUE_LIMIT);
    await expect(
      store.put("attachments/big", oversized, {
        httpMetadata: { contentType: "application/octet-stream" },
      }),
    ).rejects.toMatchObject({
      code: "ATTACHMENT_TOO_LARGE",
      status: 413,
    });
  });

  it("lists keys under the body namespace and recovers the raw key", async () => {
    await store.put("attachments/a", new Uint8Array([1]), {});
    await store.put("attachments/b", new Uint8Array([2, 2]), {});
    await store.put("raw/x", new Uint8Array([3, 3, 3]), {});
    const page = await store.list();
    const keys = page.objects
      .map((entry: AttachmentListEntry) => entry.key)
      .sort();
    expect(keys).toEqual(["attachments/a", "attachments/b", "raw/x"]);
    expect(
      page.objects.every((entry) => entry.uploadedAt instanceof Date),
    ).toBe(true);
  });

  it("reads historical KV objects while new writes target R2", async () => {
    await store.put("attachments/legacy", new Uint8Array([1, 2, 3]), {
      httpMetadata: { contentType: "text/plain" },
    });
    const r2Put = vi.fn();
    const r2Delete = vi.fn();
    const bucket = {
      get: vi.fn().mockResolvedValue(null),
      head: vi.fn().mockResolvedValue(null),
      put: r2Put,
      delete: r2Delete,
      list: vi.fn().mockResolvedValue({
        objects: [],
        truncated: false,
      }),
    } as unknown as R2Bucket;
    const selected = createAttachmentStore({
      KV: kv,
      ATTACHMENTS: bucket,
    } as Env);

    const legacy = await selected.get("attachments/legacy");
    expect(legacy?.size).toBe(3);
    expect(legacy?.httpMetadata.contentType).toBe("text/plain");

    await selected.put("attachments/new", new Uint8Array([4]), {});
    expect(r2Put).toHaveBeenCalledOnce();
    expect(await store.get("attachments/new")).toBeNull();

    await selected.delete("attachments/legacy");
    expect(r2Delete).toHaveBeenCalledWith("attachments/legacy");
    expect(await store.get("attachments/legacy")).toBeNull();
  });

  it("accepts ArrayBuffer, Blob, and streaming KV bodies", async () => {
    await store.put("array", new Uint8Array([1, 2]).buffer, {});
    await store.put("blob", new Blob([new Uint8Array([3, 4, 5])]), {});
    await store.put(
      "stream",
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([6]));
          controller.enqueue(new Uint8Array([7, 8]));
          controller.close();
        },
      }),
      {},
    );

    await expect(store.get("array").then((value) => value?.size)).resolves.toBe(
      2,
    );
    await expect(store.get("blob").then((value) => value?.size)).resolves.toBe(
      3,
    );
    await expect(
      store.get("stream").then((value) => value?.size),
    ).resolves.toBe(3);
  });

  it("tolerates missing and malformed KV metadata", async () => {
    await kv.put("attachment:no-meta", new Uint8Array([1, 2]).buffer);
    const noMeta = await store.get("no-meta");
    expect(noMeta).toMatchObject({
      size: 2,
      httpMetadata: {},
      customMetadata: {},
    });

    // Legacy sidecar still readable when the body metadata is the bare
    // `{uploadedAt}` shape from the old code.
    await kv.put("attachment:bad-meta", new Uint8Array([3]).buffer, {
      metadata: { uploadedAt: new Date().toISOString() },
    });
    await kv.put("attachment-meta:bad-meta", "{not-json");
    expect(await store.get("bad-meta")).toMatchObject({ size: 1 });

    // Overflow path: metadata slot only carries the overflow pointer, the
    // real record lives in the sidecar.
    await kv.put("attachment:bad-size", new Uint8Array([4, 5]).buffer, {
      metadata: { uploadedAt: "", overflow: "1" },
    });
    await kv.put(
      "attachment-meta:bad-size",
      JSON.stringify({ size: "unknown" }),
    );
    expect(await store.get("bad-size")).toMatchObject({ size: 2 });
  });

  it("stores a single key per attachment and reports size via list", async () => {
    await store.put("attachments/single", new Uint8Array([10, 20, 30]), {
      httpMetadata: { contentType: "image/png" },
    });
    // No sidecar was written because the metadata fit in the 1024-byte slot.
    expect(await kv.get("attachment-meta:attachments/single")).toBeNull();
    const list = await store.list({ prefix: "attachments/" });
    const entry = list.objects.find((e) => e.key === "attachments/single");
    expect(entry?.size).toBe(3);
    expect(entry?.uploadedAt).toBeInstanceOf(Date);
  });

  it("falls back to the sidecar when KV metadata overflows", async () => {
    // Construct a customMetadata payload that pushes the encoded record
    // past the 1024-byte user-metadata limit.
    const longCustom = { label: "x".repeat(2_000) };
    await store.put("attachments/big-meta", new Uint8Array([7, 7]), {
      httpMetadata: { contentType: "text/plain" },
      customMetadata: longCustom,
    });
    // The sidecar now holds the full record; the body metadata slot only
    // carries the overflow pointer.
    const withMeta = await (
      kv as unknown as {
        getWithMetadata: (
          key: string,
          type: "arrayBuffer",
        ) => Promise<{ value: ArrayBuffer | null; metadata: unknown }>;
      }
    ).getWithMetadata("attachment:attachments/big-meta", "arrayBuffer");
    expect(withMeta.value).not.toBeNull();
    expect((withMeta.metadata as { overflow?: string } | null)?.overflow).toBe(
      "1",
    );
    const sidecar = await kv.get("attachment-meta:attachments/big-meta");
    expect(sidecar).toBeTruthy();
    const parsed = JSON.parse(sidecar as string) as {
      customMetadata?: { label?: string };
    };
    expect(parsed.customMetadata?.label?.length).toBe(2_000);

    const fetched = await store.get("attachments/big-meta");
    expect(fetched?.size).toBe(2);
    expect(fetched?.customMetadata.label?.length).toBe(2_000);
  });

  it("head() does not surface the body bytes", async () => {
    await store.put("attachments/head", new Uint8Array([1, 2, 3, 4]), {});
    const head = await store.head("attachments/head");
    expect(head?.size).toBe(4);
    expect(head?.body).toBeInstanceOf(Uint8Array);
    expect((head?.body as Uint8Array).byteLength).toBe(0);
  });

  it("preserves KV pagination and treats untrusted timestamps as unknown", async () => {
    vi.spyOn(kv, "list").mockResolvedValueOnce({
      keys: [
        {
          name: "attachment:legacy",
          metadata: { uploadedAt: 123 },
        },
      ],
      list_complete: false,
      cursor: "next-page",
      cacheStatus: null,
    } as unknown as KVNamespaceListResult<unknown>);

    const page = await store.list({
      prefix: "attachments/",
      limit: 5_000,
      cursor: "cursor",
    });
    expect(page).toEqual({
      objects: [{ key: "legacy", size: 0 }],
      truncated: true,
      cursor: "next-page",
    });
    expect(kv.list).toHaveBeenCalledWith({
      prefix: "attachment:attachments/",
      limit: 1000,
      cursor: "cursor",
    });
  });

  it("detects and constructs both storage backends", () => {
    const kvEnv = { KV: kv } as Env;
    expect(createAttachmentStore(kvEnv).backend).toBe("kv");
    expect(detectStorageBackend(kvEnv)).toMatchObject({
      backend: "kv",
      maxObjectBytes: KV_VALUE_LIMIT - 1,
    });

    const r2Env = {
      KV: kv,
      ATTACHMENTS: {
        get: vi.fn(),
        head: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
        list: vi.fn(),
      } as unknown as R2Bucket,
    } as Env;
    expect(detectStorageBackend(r2Env)).toMatchObject({
      backend: "r2",
      maxObjectBytes: 5 * 1024 * 1024 * 1024 * 1024,
    });
  });
});
