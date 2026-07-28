import { describe, expect, it, beforeEach } from "vitest";
import {
  KV_VALUE_LIMIT,
  KvAttachmentStore,
  type AttachmentListEntry,
} from "../../src/platform/attachment-store";

function createMemoryKV(): KVNamespace {
  const store = new Map<string, { value: string | ArrayBuffer; meta?: unknown }>();
  return {
    async get(key: string, typeOrOptions?: "text" | "arrayBuffer" | "json" | "stream") {
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
      _opts?: KVNamespacePutOptions,
    ) {
      if (value instanceof ArrayBuffer) {
        store.set(key, { value: value.slice(0) });
      } else if (typeof value === "string") {
        store.set(key, { value });
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
        store.set(key, { value: merged.buffer });
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
        .map((name) => ({ name }));
      const listComplete: boolean = keys.length < limit && !cursor;
      const result = {
        keys,
        list_complete: listComplete,
        cacheStatus: null,
        ...(cursor ? { cursor } : {}),
      };
      return result as unknown as KVNamespaceListResult<unknown>;
    },
    async getWithMetadata(key: string) {
      const entry = store.get(key);
      return {
        value: entry ? String(entry.value) : null,
        metadata: entry?.meta ?? null,
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

  it("exposes size via head without surfacing custom metadata", async () => {
    await store.put("attachments/x", new Uint8Array([9, 9, 9]), {
      customMetadata: { tag: "secret" },
    });
    const head = await store.head("attachments/x");
    expect(head?.size).toBe(3);
    expect(head?.customMetadata).toEqual({});
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
    expect(keys).toEqual([
      "attachments/a",
      "attachments/b",
      "raw/x",
    ]);
  });
});