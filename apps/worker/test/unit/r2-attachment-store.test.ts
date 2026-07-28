import { describe, expect, it, vi } from "vitest";
import {
  R2AttachmentStore,
  createAttachmentStore,
} from "../../src/platform/attachment-store";
import type { Env } from "../../src/platform/config";

function r2Object() {
  const uploaded = new Date("2026-07-26T10:00:00.000Z");
  return {
    key: "attachments/a",
    body: new ReadableStream(),
    size: 3,
    uploaded,
    httpEtag: '"etag"',
    httpMetadata: {
      contentType: "text/plain",
      contentDisposition: "attachment",
      contentLanguage: "en",
      contentEncoding: "gzip",
      cacheControl: "private",
    },
    customMetadata: { source: "test" },
  };
}

function bucketFixture() {
  return {
    put: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(r2Object()),
    head: vi.fn().mockResolvedValue(r2Object()),
    delete: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({
      objects: [r2Object()],
      truncated: true,
      cursor: "next",
    }),
  } as unknown as R2Bucket;
}

describe("R2AttachmentStore", () => {
  it("delegates writes and preserves object metadata", async () => {
    const bucket = bucketFixture();
    const store = new R2AttachmentStore(bucket);
    const body = new Uint8Array([1, 2, 3]);
    await store.put("attachments/a", body, {
      httpMetadata: { contentType: "text/plain" },
      customMetadata: { source: "test" },
    });
    expect(bucket.put).toHaveBeenCalledWith("attachments/a", body, {
      httpMetadata: { contentType: "text/plain" },
      customMetadata: { source: "test" },
    });

    const object = await store.get("attachments/a");
    expect(object).toMatchObject({
      size: 3,
      etag: '"etag"',
      httpMetadata: {
        contentType: "text/plain",
        contentDisposition: "attachment",
        contentLanguage: "en",
        contentEncoding: "gzip",
        cacheControl: "private",
      },
      customMetadata: { source: "test" },
    });

    const head = await store.head("attachments/a");
    expect(head).toMatchObject({ size: 3, etag: '"etag"' });
    expect(head?.body).toBeInstanceOf(Uint8Array);
  });

  it("returns null for missing R2 objects and defaults optional metadata", async () => {
    const bucket = bucketFixture();
    vi.mocked(bucket.get)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        ...r2Object(),
        httpMetadata: undefined,
        customMetadata: undefined,
      } as unknown as R2ObjectBody);
    vi.mocked(bucket.head)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        ...r2Object(),
        httpMetadata: undefined,
        customMetadata: undefined,
      } as unknown as R2Object);
    const store = new R2AttachmentStore(bucket);

    await expect(store.get("missing")).resolves.toBeNull();
    await expect(store.head("missing")).resolves.toBeNull();
    await expect(store.get("defaults")).resolves.toMatchObject({
      httpMetadata: {},
      customMetadata: {},
    });
    await expect(store.head("defaults")).resolves.toMatchObject({
      httpMetadata: {},
      customMetadata: {},
    });
  });

  it("deletes and paginates R2 objects with bounded limits", async () => {
    const bucket = bucketFixture();
    const store = new R2AttachmentStore(bucket);
    await store.delete("attachments/a");
    expect(bucket.delete).toHaveBeenCalledWith("attachments/a");

    const page = await store.list({
      prefix: "attachments/",
      limit: 5_000,
      cursor: "cursor",
    });
    expect(bucket.list).toHaveBeenCalledWith({
      prefix: "attachments/",
      limit: 1000,
      cursor: "cursor",
    });
    expect(page).toEqual({
      objects: [
        {
          key: "attachments/a",
          size: 3,
          uploadedAt: new Date("2026-07-26T10:00:00.000Z"),
        },
      ],
      truncated: true,
      cursor: "next",
    });

    vi.mocked(bucket.list).mockResolvedValueOnce({
      objects: [],
      truncated: false,
    } as unknown as R2Objects);
    await expect(store.list()).resolves.toEqual({
      objects: [],
      truncated: false,
      cursor: undefined,
    });
  });

  it("uses primary R2 reads, KV fallback heads, and primary listings", async () => {
    const bucket = bucketFixture();
    const kv = {
      get: vi
        .fn()
        .mockImplementation((key: string) =>
          key.startsWith("attachment:") ? new ArrayBuffer(2) : null,
        ),
      put: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
      getWithMetadata: vi.fn(),
    } as unknown as KVNamespace;
    const store = createAttachmentStore({
      KV: kv,
      ATTACHMENTS: bucket,
    } as Env);

    expect(await store.get("attachments/a")).toMatchObject({ etag: '"etag"' });
    vi.mocked(bucket.head).mockResolvedValueOnce(null);
    expect(await store.head("legacy")).toMatchObject({ size: 2 });
    await store.list();
    expect(bucket.list).toHaveBeenCalled();
  });
});
