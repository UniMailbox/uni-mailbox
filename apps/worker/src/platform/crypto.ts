import { DomainError } from "@unimailbox/contracts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const additionalData = encoder.encode("unimailbox:credentials:v1");

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

interface EncryptedEnvelope {
  version: 1;
  iv: string;
  ciphertext: string;
}

export class CredentialCipher {
  constructor(private readonly masterKey: string) {
    if (masterKey.length < 32) {
      throw new Error(
        "CREDENTIAL_ENCRYPTION_KEY must be at least 32 characters",
      );
    }
  }

  async encrypt(payload: Readonly<Record<string, string>>): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData,
      },
      await this.importKey(),
      encoder.encode(JSON.stringify(payload)),
    );
    return JSON.stringify({
      version: 1,
      iv: toBase64(iv),
      ciphertext: toBase64(new Uint8Array(ciphertext)),
    } satisfies EncryptedEnvelope);
  }

  async decrypt(value: string): Promise<Readonly<Record<string, string>>> {
    try {
      const envelope = JSON.parse(value) as EncryptedEnvelope;
      if (
        envelope.version !== 1 ||
        typeof envelope.iv !== "string" ||
        typeof envelope.ciphertext !== "string"
      ) {
        throw new Error("Unsupported credential envelope");
      }
      const plaintext = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: fromBase64(envelope.iv),
          additionalData,
        },
        await this.importKey(),
        fromBase64(envelope.ciphertext),
      );
      const parsed = JSON.parse(decoder.decode(plaintext)) as unknown;
      if (
        !parsed ||
        typeof parsed !== "object" ||
        Object.values(parsed).some((item) => typeof item !== "string")
      ) {
        throw new Error("Invalid credential payload");
      }
      return parsed as Readonly<Record<string, string>>;
    } catch {
      throw new DomainError(
        "CREDENTIAL_DECRYPTION_FAILED",
        "The stored provider credential could not be decrypted",
        500,
      );
    }
  }

  private async importKey(): Promise<CryptoKey> {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      encoder.encode(this.masterKey),
    );
    return crypto.subtle.importKey("raw", digest, "AES-GCM", false, [
      "encrypt",
      "decrypt",
    ]);
  }
}
