import { describe, expect, it } from "vitest";
import { UploadTokenCodec } from "../../src/modules/attachments/upload-token";

describe("attachment upload tokens", () => {
  it("round-trips signed upload constraints", async () => {
    const codec = new UploadTokenCodec("upload-signing-key-".repeat(3));
    const claims = {
      uploadId: "63f9c510-00c3-48b6-95f8-cda4ef3439f0",
      objectKey: "attachments/63f9c510-00c3-48b6-95f8-cda4ef3439f0.txt",
      contentType: "text/plain",
      filename: "hello.txt",
      disposition: "attachment" as const,
      size: 5,
      expiresAt: Date.now() + 60_000,
    };

    await expect(codec.decode(await codec.encode(claims))).resolves.toEqual(
      claims,
    );
  });

  it("rejects tampering and expiry", async () => {
    const codec = new UploadTokenCodec("upload-signing-key-".repeat(3));
    const token = await codec.encode({
      uploadId: "63f9c510-00c3-48b6-95f8-cda4ef3439f0",
      objectKey: "attachments/file.txt",
      contentType: "text/plain",
      filename: "hello.txt",
      disposition: "attachment",
      size: 5,
      expiresAt: Date.now() - 1,
    });

    await expect(codec.decode(token)).rejects.toMatchObject({
      code: "ATTACHMENT_UPLOAD_TOKEN_INVALID",
    });
    await expect(codec.decode(`${token.slice(0, -1)}x`)).rejects.toMatchObject({
      code: "ATTACHMENT_UPLOAD_TOKEN_INVALID",
    });
  });
});
