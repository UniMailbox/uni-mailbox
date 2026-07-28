import { describe, expect, it } from "vitest";
import { createAttachmentDownloadResponse } from "../../src/modules/attachments/download-response";

describe("attachment download response", () => {
  it("preserves an R2 body stream without reading it before the response is consumed", async () => {
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.close();
      },
    });

    const response = await createAttachmentDownloadResponse(
      {
        body,
        size: 3,
        httpMetadata: {},
        customMetadata: {},
        etag: '"r2-etag"',
      },
      {
        filename: "large.bin",
        mimeType: "application/octet-stream",
        disposition: "attachment",
      },
    );

    expect(response.body).toBe(body);
    expect(response.headers.get("content-length")).toBe("3");
    expect(response.headers.get("etag")).toBe('"r2-etag"');
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([
      1, 2, 3,
    ]);
    expect(pulls).toBeGreaterThanOrEqual(1);
  });

  it("forces unsafe inline content to download and retains a stable KV etag", async () => {
    const response = await createAttachmentDownloadResponse(
      {
        body: new Uint8Array([1]),
        size: 1,
        httpMetadata: {},
        customMetadata: {},
      },
      {
        filename: null,
        mimeType: "text/html",
        disposition: "inline",
      },
    );

    expect(response.headers.get("content-disposition")).toContain("attachment");
    expect(response.headers.get("etag")).toBe(
      'W/"4bf5122f344554c53bde2ebb8cd2b7e3"',
    );
  });

  it("does not buffer a stream when an etag is unavailable", async () => {
    const body = new ReadableStream<Uint8Array>();
    const response = await createAttachmentDownloadResponse(
      {
        body,
        size: 0,
        httpMetadata: {},
        customMetadata: {},
      },
      {
        filename: "empty.bin",
        mimeType: "application/octet-stream",
        disposition: "attachment",
      },
    );

    expect(response.body).toBe(body);
    expect(response.headers.has("etag")).toBe(false);
  });

  it("allows supported image content to render inline", async () => {
    const response = await createAttachmentDownloadResponse(
      {
        body: new Uint8Array([1]).buffer,
        size: 1,
        httpMetadata: {},
        customMetadata: {},
      },
      {
        filename: "photo name.png",
        mimeType: "image/png",
        disposition: "inline",
      },
    );

    expect(response.headers.get("content-disposition")).toBe(
      "inline; filename*=UTF-8''photo%20name.png",
    );
  });
});
