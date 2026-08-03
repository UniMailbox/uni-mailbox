import { describe, expect, it } from "vitest";
import { Md5, md5Hex } from "../../src/modules/attachments/file-catalog";

describe("MD5", () => {
  it.each([
    ["", "d41d8cd98f00b204e9800998ecf8427e"],
    ["a", "0cc175b9c0f1b6a831c399e269772661"],
    ["abc", "900150983cd24fb0d6963f7d28e17f72"],
    ["message digest", "f96b697d7cb7938d525a2f31aaf161d0"],
    ["abcdefghijklmnopqrstuvwxyz", "c3fcd3d76192e4007dfb496cca67e13b"],
  ])("hashes RFC 1321 vector %j", (input, expected) => {
    expect(new Md5().update(new TextEncoder().encode(input)).hex()).toBe(
      expected,
    );
  });

  it("hashes a chunked stream without buffering the entire body", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("mes"));
        controller.enqueue(encoder.encode("sage "));
        controller.enqueue(encoder.encode("digest"));
        controller.close();
      },
    });
    await expect(md5Hex(stream)).resolves.toBe(
      "f96b697d7cb7938d525a2f31aaf161d0",
    );
  });
});
