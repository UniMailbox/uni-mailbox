import { describe, expect, it } from "vitest";
import { CredentialCipher } from "../../src/platform/crypto";

describe("CredentialCipher additional cases", () => {
  it("rejects short master keys", () => {
    expect(() => new CredentialCipher("short-key")).toThrowError(
      /CREDENTIAL_ENCRYPTION_KEY/,
    );
  });

  it("wraps any decryption failure as a domain error", async () => {
    const cipher = new CredentialCipher("master-key-".repeat(4));
    await expect(cipher.decrypt("not-a-real-envelope")).rejects.toMatchObject({
      code: "CREDENTIAL_DECRYPTION_FAILED",
      status: 500,
    });
  });

  it("rejects envelopes with an unsupported version", async () => {
    const cipher = new CredentialCipher("master-key-".repeat(4));
    await expect(
      cipher.decrypt(
        JSON.stringify({ version: 99, iv: "AAAA", ciphertext: "BBBB" }),
      ),
    ).rejects.toMatchObject({ code: "CREDENTIAL_DECRYPTION_FAILED" });
  });

  it("rejects payloads whose values are not strings", async () => {
    const cipher = new CredentialCipher("master-key-".repeat(4));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: new TextEncoder().encode("unimailbox:credentials:v1"),
      },
      await crypto.subtle.importKey(
        "raw",
        new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode("master-key-".repeat(4)),
          ),
        ),
        "AES-GCM",
        false,
        ["encrypt"],
      ),
      new TextEncoder().encode(JSON.stringify({ not: 1 })),
    );
    const envelope = JSON.stringify({
      version: 1,
      iv: btoa(String.fromCharCode(...iv)),
      ciphertext: btoa(String.fromCharCode(...new Uint8Array(ciphertext))),
    });

    await expect(cipher.decrypt(envelope)).rejects.toMatchObject({
      code: "CREDENTIAL_DECRYPTION_FAILED",
    });
  });
});
