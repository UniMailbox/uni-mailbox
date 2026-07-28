import { applyD1Migrations, env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Principal } from "@unimailbox/contracts";
import { MailboxApplicationService } from "../../src/modules/mailboxes";
import { CursorCodec } from "../../src/modules/messages/cursor";
import { MessageApplicationService } from "../../src/modules/messages";

const userId = "11111111-1111-4111-8111-111111111111";
const senderId = "33333333-3333-4333-8333-333333333333";
const internalId = "44444444-4444-4444-8444-444444444444";

const principal: Principal = {
  userId,
  email: "owner@example.com",
  permissions: new Set([
    "message.read",
    "message.send",
    "message.delete",
    "mailbox.create",
    "mailbox.manage",
    "mailbox.share",
  ]),
};

function service() {
  const app = {
    env: {
      DB: env.DB,
      KV: env.KV,
      ATTACHMENTS: env.ATTACHMENTS,
      OUTBOUND_QUEUE: env.OUTBOUND_QUEUE,
      ASSETS: {} as Fetcher,
      INSTALLATION_TOKEN: "x".repeat(32),
      AUTH_SIGNING_KEY: "x".repeat(32),
      CREDENTIAL_ENCRYPTION_KEY: "x".repeat(32),
    },
    providers: {} as never,
    credentials: {} as never,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
  return new MessageApplicationService(
    app,
    new MailboxApplicationService(app.env),
    new CursorCodec("x".repeat(32)),
  );
}

async function send(to: string[], key: string) {
  return service().send(
    principal,
    {
      mailboxId: senderId,
      to,
      cc: [],
      bcc: [],
      subject: "Partition test",
      html: "<p>Body</p>",
      text: "Body",
      includeSignature: true,
      attachmentIds: [],
    },
    key,
  );
}

describe("message recipient partitioning", () => {
  beforeEach(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO users (
           id, email, password_hash, password_salt, password_iterations,
           display_name
         ) VALUES (?, 'owner@example.com', 'hash', 'salt', 1, 'Owner')`,
      ).bind(userId),
      env.DB.prepare(
        `INSERT INTO encrypted_credentials (
           id, encrypted_payload, encryption_version
         ) VALUES ('55555555-5555-4555-8555-555555555555', 'encrypted', 1)`,
      ),
      env.DB.prepare(
        `INSERT INTO provider_connections (
           id, provider_key, label, credential_id, status
         ) VALUES (
           '66666666-6666-4666-8666-666666666666', 'brevo', 'Primary',
           '55555555-5555-4555-8555-555555555555', 'active'
         )`,
      ),
      env.DB.prepare(
        `INSERT INTO domains (
           id, name, outbound_connection_id
         ) VALUES (
           '22222222-2222-4222-8222-222222222222', 'example.com',
           '66666666-6666-4666-8666-666666666666'
         )`,
      ),
      env.DB.prepare(
        `INSERT INTO mailboxes (
           id, domain_id, owner_user_id, address, display_name
         ) VALUES (?, ?, ?, 'sender@example.com', 'Sender')`,
      ).bind(senderId, "22222222-2222-4222-8222-222222222222", userId),
      env.DB.prepare(
        `INSERT INTO mailboxes (
           id, domain_id, owner_user_id, address, display_name
         ) VALUES (?, ?, ?, 'internal@example.com', 'Internal')`,
      ).bind(internalId, "22222222-2222-4222-8222-222222222222", userId),
    ]);
  });

  it("delivers an internal-only message without a provider job", async () => {
    const result = await send(["internal@example.com"], "internal-only");
    const jobs = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM outbound_jobs",
    ).first<number>("count");
    const inbox = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM mailbox_messages
       WHERE message_id = ? AND mailbox_id = ? AND folder = 'inbox'`,
    )
      .bind(result.messageId, internalId)
      .first<number>("count");

    expect(result.status).toBe("sent");
    expect(jobs).toBe(0);
    expect(inbox).toBe(1);
  });

  it("queues external recipients without creating an internal link", async () => {
    const result = await send(["outside@example.net"], "external-only");
    const job = await env.DB.prepare(
      "SELECT status FROM outbound_jobs WHERE message_id = ?",
    )
      .bind(result.messageId)
      .first<{ status: string }>();
    const inbox = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM mailbox_messages
       WHERE message_id = ? AND folder = 'inbox'`,
    )
      .bind(result.messageId)
      .first<number>("count");

    expect(result.status).toBe("queued");
    expect(job?.status).toBe("enqueued");
    expect(inbox).toBe(0);
  });

  it("handles mixed recipients once and replays the idempotent response", async () => {
    const first = await send(
      ["internal@example.com", "outside@example.net"],
      "mixed",
    );
    const replay = await send(
      ["internal@example.com", "outside@example.net"],
      "mixed",
    );
    const messages = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM messages",
    ).first<number>("count");
    const recipients = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM message_recipients WHERE message_id = ?",
    )
      .bind(first.messageId)
      .first<number>("count");

    expect(first.status).toBe("queued");
    expect(replay).toEqual(first);
    expect(messages).toBe(1);
    expect(recipients).toBe(2);
  });
});
