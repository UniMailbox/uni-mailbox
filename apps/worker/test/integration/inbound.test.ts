import { applyD1Migrations, env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "../../src/app-context";
import { InboundMailService } from "../../src/modules/inbound-mail";
import { createAttachmentStore } from "../../src/platform/attachment-store";

function emailMessage(
  raw: string,
  to = "inbox@example.com",
): ForwardableEmailMessage {
  return {
    from: "sender@outside.example",
    to,
    raw: new Blob([raw]).stream(),
    rawSize: new TextEncoder().encode(raw).byteLength,
    headers: new Headers(),
    setReject: vi.fn(),
    forward: vi.fn(),
    reply: vi.fn(),
  } as unknown as ForwardableEmailMessage;
}

function context(
  overrides: Partial<AppContext["env"]> = {},
): Pick<AppContext, "env" | "logger" | "attachmentStore"> {
  const envRecord = env as unknown as Record<string, unknown>;
  const baseEnv: AppContext["env"] = {
    DB: env.DB,
    KV: env.KV,
    ATTACHMENTS: envRecord.ATTACHMENTS as R2Bucket | undefined,
    OUTBOUND_QUEUE: env.OUTBOUND_QUEUE,
    ASSETS: {} as Fetcher,
    AUTH_SIGNING_KEY: "x".repeat(32),
    CREDENTIAL_ENCRYPTION_KEY: "x".repeat(32),
    ...overrides,
  };
  return {
    env: baseEnv,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    attachmentStore: createAttachmentStore(baseEnv),
  };
}

function envFixture(): AppContext["env"] {
  return context().env;
}

async function seedMailbox(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (
         id, email, password_hash, password_salt, password_iterations,
         display_name
       ) VALUES (?, 'owner@example.com', 'hash', 'salt', 1, 'Owner')`,
    ).bind("11111111-1111-4111-8111-111111111111"),
    env.DB.prepare(
      "INSERT INTO domains (id, name) VALUES (?, 'example.com')",
    ).bind("22222222-2222-4222-8222-222222222222"),
    env.DB.prepare(
      `INSERT INTO mailboxes (
         id, domain_id, owner_user_id, address, display_name
       ) VALUES (?, ?, ?, 'inbox@example.com', 'Inbox')`,
    ).bind(
      "33333333-3333-4333-8333-333333333333",
      "22222222-2222-4222-8222-222222222222",
      "11111111-1111-4111-8111-111111111111",
    ),
  ]);
}

describe("inbound mail persistence", () => {
  beforeEach(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
    await seedMailbox();
  });

  it("preserves UTF-8 bodies, binary attachments, and missing filenames", async () => {
    const raw = [
      "From: Sender <sender@outside.example>",
      "To: inbox@example.com",
      "Subject: 你好 Singapore",
      "Message-ID: <inbound-1@example.com>",
      "MIME-Version: 1.0",
      'Content-Type: multipart/mixed; boundary="unimailbox-boundary"',
      "",
      "--unimailbox-boundary",
      'Content-Type: text/plain; charset="utf-8"',
      "Content-Transfer-Encoding: 8bit",
      "",
      "正文 with emoji ✉️",
      "--unimailbox-boundary",
      "Content-Type: application/octet-stream",
      "Content-Disposition: attachment",
      "Content-Transfer-Encoding: base64",
      "",
      "AAECA/8=",
      "--unimailbox-boundary--",
      "",
    ].join("\r\n");
    const message = emailMessage(raw);

    await new InboundMailService(context() as AppContext).receive(message);

    expect(message.setReject).not.toHaveBeenCalled();
    const stored = await env.DB.prepare(
      `SELECT subject, text_body, raw_object_key FROM messages
       WHERE message_id_header = ?`,
    )
      .bind("<inbound-1@example.com>")
      .first<{
        subject: string;
        text_body: string;
        raw_object_key: string;
      }>();
    expect(stored?.subject).toBe("你好 Singapore");
    expect(stored?.text_body).toContain("正文 with emoji");
    const attachment = await env.DB.prepare(
      `SELECT filename, size_bytes, object_key FROM message_attachments`,
    ).first<{
      filename: string | null;
      size_bytes: number;
      object_key: string;
    }>();
    expect(attachment?.filename).toBeNull();
    expect(attachment?.size_bytes).toBe(5);
    const store = createAttachmentStore(envFixture());
    expect(await store.head(stored?.raw_object_key ?? "")).not.toBeNull();
    expect(await store.head(attachment?.object_key ?? "")).not.toBeNull();
  });

  it("stores unknown recipients canonically under the store policy", async () => {
    await env.DB.prepare(
      `UPDATE system_settings
       SET unknown_recipient_policy = 'store' WHERE id = 1`,
    ).run();
    const message = emailMessage(
      [
        "From: sender@outside.example",
        "To: missing@example.com",
        "Subject: forensic copy",
        "",
        "body",
      ].join("\r\n"),
      "missing@example.com",
    );

    await new InboundMailService(context() as AppContext).receive(message);

    expect(message.setReject).not.toHaveBeenCalled();
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM messages",
      ).first<number>("count"),
    ).toBe(1);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM mailbox_messages",
      ).first<number>("count"),
    ).toBe(0);
  });

  it("queues concrete R2 keys if the D1 batch fails", async () => {
    const send = vi.fn();
    const failingDatabase = {
      prepare: (query: string) => env.DB.prepare(query),
      batch: () => Promise.reject(new Error("simulated D1 failure")),
    } as unknown as D1Database;
    const message = emailMessage(
      [
        "From: sender@outside.example",
        "To: inbox@example.com",
        "Subject: failure",
        "",
        "body",
      ].join("\r\n"),
    );

    await expect(
      new InboundMailService(
        context({
          DB: failingDatabase,
          OUTBOUND_QUEUE: { send } as unknown as Queue,
        }) as AppContext,
      ).receive(message),
    ).rejects.toThrow("simulated D1 failure");
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "orphan_object_cleanup",
        objectKeys: expect.arrayContaining([expect.stringMatching(/^raw\//u)]),
      }),
    );
  });
});
