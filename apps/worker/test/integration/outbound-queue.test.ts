import { applyD1Migrations, env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DomainError,
  parseProviderKey,
  type ProviderPlugin,
} from "@unimailbox/contracts";
import { ProviderRegistry } from "../../src/integrations/providers";
import { processOutboundJob } from "../../src/modules/outbound-mail";
import { CredentialCipher } from "../../src/platform/crypto";

const key = parseProviderKey("contract-test");
const connectionId = "66666666-6666-4666-8666-666666666666";
const messageId = "77777777-7777-4777-8777-777777777777";
const jobId = "88888888-8888-4888-8888-888888888888";
const cipher = new CredentialCipher("e".repeat(32));

describe("durable outbound Queue processing", () => {
  beforeEach(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO encrypted_credentials (
           id, encrypted_payload, encryption_version
         ) VALUES (?, ?, 1)`,
      ).bind(
        "55555555-5555-4555-8555-555555555555",
        await cipher.encrypt({ apiKey: "provider-key" }),
      ),
      env.DB.prepare(
        `INSERT INTO provider_connections (
           id, provider_key, label, credential_id, status
         ) VALUES (?, ?, 'Contract provider', ?, 'active')`,
      ).bind(connectionId, key, "55555555-5555-4555-8555-555555555555"),
      env.DB.prepare(
        `INSERT INTO messages (
           id, thread_id, from_address, subject, provider_key,
           provider_connection_id, status
         ) VALUES (?, ?, 'sender@example.com', 'Queue test', ?, ?, 'queued')`,
      ).bind(messageId, messageId, key, connectionId),
      env.DB.prepare(
        `INSERT INTO message_recipients (
           id, message_id, type, address, display_name
         ) VALUES (?, ?, 'to', 'outside@example.net', '')`,
      ).bind("99999999-9999-4999-8999-999999999999", messageId),
      env.DB.prepare(
        `INSERT INTO outbound_jobs (id, message_id, status)
         VALUES (?, ?, 'enqueued')`,
      ).bind(jobId, messageId),
    ]);
  });

  it("persists retry state and then completes with the same provider message", async () => {
    const send = vi
      .fn<ProviderPlugin["outbound"]["send"]>()
      .mockRejectedValueOnce(
        new DomainError(
          "PROVIDER_TEMPORARY",
          "Temporary provider failure",
          503,
          {
            code: "PROVIDER_TEMPORARY",
            message: "Temporary provider failure",
            retryable: true,
            category: "provider",
          },
        ),
      )
      .mockResolvedValueOnce({
        providerMessageId: "provider-result-1",
        acceptedAt: "2026-07-27T00:00:00.000Z",
      });
    const plugin: ProviderPlugin = {
      outbound: {
        key,
        validateConnection: vi.fn(),
        send,
      },
      validateConnectionInput: (value) => value,
    };
    const context = {
      env: {
        DB: env.DB,
        KV: env.KV,
        ATTACHMENTS: env.ATTACHMENTS,
        OUTBOUND_QUEUE: env.OUTBOUND_QUEUE,
        ASSETS: {} as Fetcher,
        INSTALLATION_TOKEN: "x".repeat(32),
        AUTH_SIGNING_KEY: "x".repeat(32),
        CREDENTIAL_ENCRYPTION_KEY: "e".repeat(32),
      },
      providers: new ProviderRegistry(new Map([[key, plugin]])),
      credentials: cipher,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };
    const job = { jobId, messageId };

    await expect(processOutboundJob(context, job)).rejects.toMatchObject({
      code: "PROVIDER_TEMPORARY",
    });
    const pending = await env.DB.prepare(
      "SELECT status, attempts, last_error FROM outbound_jobs WHERE id = ?",
    )
      .bind(jobId)
      .first<{
        status: string;
        attempts: number;
        last_error: string;
      }>();
    expect(pending).toMatchObject({ status: "pending", attempts: 1 });
    expect(pending?.last_error).not.toContain("provider-key");

    await env.DB.prepare(
      `UPDATE outbound_jobs
       SET available_at = datetime('now', '-1 second') WHERE id = ?`,
    )
      .bind(jobId)
      .run();
    await processOutboundJob(context, job);

    const completed = await env.DB.prepare(
      `SELECT j.status AS job_status, m.status AS message_status,
              m.provider_message_id
       FROM outbound_jobs j
       JOIN messages m ON m.id = j.message_id
       WHERE j.id = ?`,
    )
      .bind(jobId)
      .first<{
        job_status: string;
        message_status: string;
        provider_message_id: string;
      }>();
    expect(completed).toEqual({
      job_status: "succeeded",
      message_status: "sent",
      provider_message_id: "provider-result-1",
    });
    expect(send).toHaveBeenCalledTimes(2);
  });
});
