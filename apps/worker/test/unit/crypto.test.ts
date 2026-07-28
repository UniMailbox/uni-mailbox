import { describe, expect, it } from "vitest";
import { CredentialCipher } from "../../src/platform/crypto";

describe("encrypted credential storage", () => {
  it("round-trips JSON with AES-GCM without exposing plaintext", async () => {
    const cipher = new CredentialCipher("master-key-".repeat(4));
    const encrypted = await cipher.encrypt({
      apiKey: "xkeysib-secret",
      webhookSecret: "webhook-secret",
    });

    expect(encrypted).not.toContain("xkeysib-secret");
    await expect(cipher.decrypt(encrypted)).resolves.toEqual({
      apiKey: "xkeysib-secret",
      webhookSecret: "webhook-secret",
    });
  });

  it("rejects ciphertext encrypted under another key", async () => {
    const first = new CredentialCipher("first-master-key-".repeat(3));
    const second = new CredentialCipher("second-master-key".repeat(3));
    const encrypted = await first.encrypt({ apiKey: "secret" });

    await expect(second.decrypt(encrypted)).rejects.toMatchObject({
      code: "CREDENTIAL_DECRYPTION_FAILED",
    });
  });
});
