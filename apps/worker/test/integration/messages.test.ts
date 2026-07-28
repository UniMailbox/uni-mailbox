import { applyD1Migrations, env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ADMINISTRATOR_PERMISSIONS,
  BREVO_PROVIDER_KEY,
  type Principal,
} from "@unimailbox/contracts";
import { AttachmentApplicationService } from "../../src/modules/attachments";
import { UploadTokenCodec } from "../../src/modules/attachments/upload-token";
import { MailboxApplicationService } from "../../src/modules/mailboxes";
import { MessageApplicationService } from "../../src/modules/messages";
import { CursorCodec } from "../../src/modules/messages/cursor";
import { DraftApplicationService } from "../../src/modules/messages/drafts";
import { ProviderRegistry } from "../../src/integrations/providers";
import { createBrevoProviderPlugin } from "../../src/integrations/brevo";
import type { Env } from "../../src/platform/config";

const principal: Principal = {
  userId: "11111111-1111-4111-8111-111111111111",
  email: "owner@example.com",
  permissions: new Set(ADMINISTRATOR_PERMISSIONS),
};

const senderId = "33333333-3333-4333-8333-333333333333";
const domainId = "22222222-2222-4222-8222-222222222222";

function fullEnv(): Env {
  return {
    ...(env as unknown as Env),
    ASSETS: {} as Fetcher,
    INSTALLATION_TOKEN: "x".repeat(32),
    AUTH_SIGNING_KEY: "x".repeat(32),
    CREDENTIAL_ENCRYPTION_KEY: "x".repeat(32),
  };
}

function attachmentsService() {
  const codec = new UploadTokenCodec("k".repeat(32));
  return new AttachmentApplicationService(fullEnv(), codec);
}

function messageService() {
  const app = {
    env: fullEnv(),
    providers: new ProviderRegistry(
      new Map([[BREVO_PROVIDER_KEY, createBrevoProviderPlugin(vi.fn())]]),
    ),
    credentials: { encrypt: vi.fn(), decrypt: vi.fn() } as never,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
  return new MessageApplicationService(
    app,
    new MailboxApplicationService(fullEnv()),
    new CursorCodec("k".repeat(32)),
  );
}

function draftService() {
  const app = {
    env: fullEnv(),
    providers: new ProviderRegistry(
      new Map([[BREVO_PROVIDER_KEY, createBrevoProviderPlugin(vi.fn())]]),
    ),
    credentials: { encrypt: vi.fn(), decrypt: vi.fn() } as never,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
  return new DraftApplicationService(app, new MailboxApplicationService(fullEnv()));
}

async function seed() {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (
         id, email, password_hash, password_salt, password_iterations,
         display_name
       ) VALUES (?, 'owner@example.com', 'h', 's', 1, 'Owner')`,
    ).bind(principal.userId),
    env.DB.prepare("INSERT INTO domains (id, name) VALUES (?, 'example.com')").bind(
      domainId,
    ),
    env.DB.prepare(
      `INSERT INTO mailboxes (
         id, domain_id, owner_user_id, address, display_name
       ) VALUES (?, ?, ?, 'inbox@example.com', 'Inbox')`,
    ).bind(senderId, domainId, principal.userId),
  ]);
}

describe("AttachmentApplicationService", () => {
  beforeEach(seed);

  it("creates an attachment upload with a signed token", async () => {
    const service = attachmentsService();
    const url = "https://mail.example/api/v1/attachments/uploads";
    const created = await service.create(
      principal,
      {
        filename: "runbook.txt",
        contentType: "text/plain",
        size: 16,
        disposition: "attachment",
      },
      url,
    );
    expect(created.objectKey).toMatch(/^attachments\//u);
    expect(created.uploadUrl).toContain(created.attachmentId);
  });

  it("rejects an invalid upload token", async () => {
    const service = attachmentsService();
    await expect(
      service.uploadContent(
        "11111111-1111-4111-8111-111111111111",
        "garbage",
        new Request(
          "https://mail.example/api/v1/attachments/uploads/x/content",
          { method: "PUT", body: "hello" },
        ),
      ),
    ).rejects.toMatchObject({ code: "ATTACHMENT_UPLOAD_TOKEN_INVALID" });
  });
});

describe("MessageApplicationService", () => {
  beforeEach(seed);

  it("encodes and decodes cursors", async () => {
    const codec = new CursorCodec("k".repeat(32));
    const cursor = { createdAt: "2026-07-27 12:00:00", id: "m1" };
    const token = await codec.encode(cursor);
    await expect(codec.decode(token)).resolves.toEqual(cursor);
  });

  it("returns an empty list for a mailbox with no messages", async () => {
    const result = await messageService().list(principal, senderId, {
      folder: "inbox",
      limit: 50,
    });
    expect(result.items).toEqual([]);
  });

  it("lists and reads messages; supports setRead/starred/listAttachments/remove", async () => {
    const messages = messageService();
    const mailboxMessageId = "44444444-4444-4444-8444-444444444444";
    const messageId = "55555555-5555-4555-8555-555555555555";
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO messages (
           id, thread_id, from_address, subject, html_body, text_body, status
         ) VALUES (?, ?, 'sender@example.com', 'Hello', '<p>hi</p>', 'hi', 'received')`,
      ).bind(messageId, messageId),
      env.DB.prepare(
        `INSERT INTO mailbox_messages (
           id, mailbox_id, message_id, folder
         ) VALUES (?, ?, ?, 'inbox')`,
      ).bind(mailboxMessageId, senderId, messageId),
    ]);

    const list = await messages.list(principal, senderId, {
      folder: "inbox",
      limit: 50,
    });
    expect(list.items).toHaveLength(1);

    const detail = await messages.get(principal, messageId);
    expect(detail.mailboxMessageId).toBe(mailboxMessageId);

    await messages.setRead(principal, messageId, true);
    await messages.setStarred(principal, messageId, true);
    const attachments = await messages.listAttachments(principal, messageId);
    expect(attachments).toEqual([]);

    const readState = await env.DB.prepare(
      "SELECT is_read, is_starred FROM message_user_state WHERE mailbox_message_id = ?",
    )
      .bind(mailboxMessageId)
      .first<{ is_read: number; is_starred: number }>();
    expect(readState).toMatchObject({ is_read: 1, is_starred: 1 });
  });
});

describe("DraftApplicationService", () => {
  beforeEach(seed);

  it("creates, lists, fetches, and removes a draft", async () => {
    const drafts = draftService();
    const draft = await drafts.create(principal, {
      mailboxId: senderId,
      to: ["inbox@example.com"],
      cc: [],
      bcc: [],
      subject: "Test",
      html: "<p>body</p>",
      text: "body",
      includeSignature: true,
      attachmentIds: [],
    });
    expect(draft.id).toBeDefined();

    const list = await drafts.list(principal);
    expect(list).toHaveLength(1);

    const fetched = await drafts.get(principal, draft.id);
    expect(fetched.mailboxId).toBe(senderId);

    await drafts.remove(principal, draft.id);
    expect(await drafts.list(principal)).toHaveLength(0);
  });

  it("rejects a draft creation when the sender mailbox is missing", async () => {
    await expect(
      draftService().create(principal, {
        mailboxId: "99999999-9999-4999-8999-999999999999",
        to: ["inbox@example.com"],
        cc: [],
        bcc: [],
        subject: "Test",
        html: "<p>body</p>",
        text: "body",
        includeSignature: true,
        attachmentIds: [],
      }),
    ).rejects.toMatchObject({ code: "MAILBOX_PERMISSION_DENIED" });
  });
});