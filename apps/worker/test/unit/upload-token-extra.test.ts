import { describe, expect, it } from "vitest";
import { UploadTokenCodec } from "../../src/modules/attachments/upload-token";

describe("UploadTokenCodec edge cases", () => {
  const key = "upload-signing-key-".repeat(3);

  it("rejects tokens missing a payload or signature", async () => {
    const codec = new UploadTokenCodec(key);
    await expect(codec.decode("onlypayload")).rejects.toMatchObject({
      code: "ATTACHMENT_UPLOAD_TOKEN_INVALID",
    });
    await expect(codec.decode(".only-signature")).rejects.toMatchObject({
      code: "ATTACHMENT_UPLOAD_TOKEN_INVALID",
    });
  });

  it("rejects tokens with malformed claims", async () => {
    const codec = new UploadTokenCodec(key);
    const raw = JSON.stringify({ uploadId: 1, objectKey: "x" });
    const payload = btoa(raw)
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/u, "");
    const signatureBytes = new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        await crypto.subtle.importKey(
          "raw",
          new TextEncoder().encode(key),
          { name: "HMAC", hash: "SHA-256" },
          false,
          ["sign"],
        ),
        new TextEncoder().encode(payload),
      ),
    );
    const signature = btoa(String.fromCharCode(...signatureBytes))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/u, "");

    await expect(codec.decode(`${payload}.${signature}`)).rejects.toMatchObject({
      code: "ATTACHMENT_UPLOAD_TOKEN_INVALID",
    });
  });

  it("rejects tokens whose disposition is invalid", async () => {
    const codec = new UploadTokenCodec(key);
    const payload = btoa(
      JSON.stringify({
        uploadId: "11111111-1111-4111-8111-111111111111",
        objectKey: "attachments/x.txt",
        contentType: "text/plain",
        filename: "x.txt",
        disposition: "unknown",
        size: 5,
        expiresAt: Date.now() + 60_000,
      }),
    )
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/u, "");
    const signatureBytes = new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        await crypto.subtle.importKey(
          "raw",
          new TextEncoder().encode(key),
          { name: "HMAC", hash: "SHA-256" },
          false,
          ["sign"],
        ),
        new TextEncoder().encode(payload),
      ),
    );
    const signature = btoa(String.fromCharCode(...signatureBytes))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/u, "");
    await expect(codec.decode(`${payload}.${signature}`)).rejects.toMatchObject({
      code: "ATTACHMENT_UPLOAD_TOKEN_INVALID",
    });
  });

  it("rejects tokens signed with the wrong key", async () => {
    const codec = new UploadTokenCodec("key-a-".repeat(5));
    const otherCodec = new UploadTokenCodec("key-b-".repeat(5));
    const token = await codec.encode({
      uploadId: "11111111-1111-4111-8111-111111111111",
      objectKey: "attachments/x.txt",
      contentType: "text/plain",
      filename: "x.txt",
      disposition: "attachment",
      size: 5,
      expiresAt: Date.now() + 60_000,
    });
    await expect(otherCodec.decode(token)).rejects.toMatchObject({
      code: "ATTACHMENT_UPLOAD_TOKEN_INVALID",
    });
  });

  it("rejects tokens with a non-safe-integer size", async () => {
    const codec = new UploadTokenCodec(key);
    const payload = btoa(
      JSON.stringify({
        uploadId: "11111111-1111-4111-8111-111111111111",
        objectKey: "attachments/x.txt",
        contentType: "text/plain",
        filename: "x.txt",
        disposition: "attachment",
        size: Number.MAX_SAFE_INTEGER + 2,
        expiresAt: Date.now() + 60_000,
      }),
    )
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/u, "");
    const signatureBytes = new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        await crypto.subtle.importKey(
          "raw",
          new TextEncoder().encode(key),
          { name: "HMAC", hash: "SHA-256" },
          false,
          ["sign"],
        ),
        new TextEncoder().encode(payload),
      ),
    );
    const signature = btoa(String.fromCharCode(...signatureBytes))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/u, "");
    await expect(codec.decode(`${payload}.${signature}`)).rejects.toMatchObject({
      code: "ATTACHMENT_UPLOAD_TOKEN_INVALID",
    });
  });
});