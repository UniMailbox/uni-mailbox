import { applyD1Migrations, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  backfillAttachmentFileMd5,
  deleteAttachmentFileIfUnreferenced,
} from "../../src/modules/attachments/file-catalog";
import { createAttachmentStore } from "../../src/platform/attachment-store";
import type { AppContext } from "../../src/app-context";

function context(): Pick<AppContext, "env" | "attachmentStore"> {
  const workerEnv = {
    ...(env as unknown as AppContext["env"]),
    ASSETS: {} as Fetcher,
    AUTH_SIGNING_KEY: "x".repeat(32),
    CREDENTIAL_ENCRYPTION_KEY: "x".repeat(32),
  };
  return { env: workerEnv, attachmentStore: createAttachmentStore(workerEnv) };
}

async function seedMessages(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (
         id, email, password_hash, password_salt, password_iterations,
         display_name
       ) VALUES (?, 'owner@example.com', 'hash', 'salt', 1, 'Owner')`,
    ).bind("11111111-1111-4111-8111-111111111111"),
    ...[
      "33333333-3333-4333-8333-333333333333",
      "44444444-4444-4444-8444-444444444444",
    ].map((id) =>
      env.DB.prepare(
        `INSERT INTO messages (
           id, from_address, from_name, subject, status, created_by_user_id
         ) VALUES (?, 'sender@example.com', 'Sender', 'Attachment', 'received', ?)`,
      ).bind(id, "11111111-1111-4111-8111-111111111111"),
    ),
  ]);
}

describe("attachment file catalog", () => {
  beforeEach(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
    await seedMessages();
  });

  it("backfills MD5 and merges legacy byte-identical objects", async () => {
    const app = context();
    const firstFile = {
      id: "55555555-5555-4555-8555-555555555555",
      object_key: "attachments/legacy-first",
      md5: null,
      size_bytes: 3,
    };
    const secondFile = {
      id: "66666666-6666-4666-8666-666666666666",
      object_key: "attachments/legacy-second",
      md5: null,
      size_bytes: 3,
    };
    await app.attachmentStore.put(
      firstFile.object_key,
      new Uint8Array([1, 2, 3]),
      {},
    );
    await app.attachmentStore.put(
      secondFile.object_key,
      new Uint8Array([1, 2, 3]),
      {},
    );
    await env.DB.batch([
      ...[firstFile, secondFile].map((file) =>
        env.DB.prepare(
          `INSERT INTO attachment_files (
             id, object_key, dedupe_key, md5, size_bytes
           ) VALUES (?, ?, ?, NULL, ?)`,
        ).bind(
          file.id,
          file.object_key,
          `legacy:${file.object_key}`,
          file.size_bytes,
        ),
      ),
      env.DB.prepare(
        `INSERT INTO message_attachments (
           id, message_id, object_key, filename, mime_type, size_bytes,
           disposition, file_id
         ) VALUES (?, ?, ?, 'same.bin', 'application/octet-stream', 3,
                   'attachment', ?)`,
      ).bind(
        "77777777-7777-4777-8777-777777777777",
        "33333333-3333-4333-8333-333333333333",
        firstFile.object_key,
        firstFile.id,
      ),
      env.DB.prepare(
        `INSERT INTO message_attachments (
           id, message_id, object_key, filename, mime_type, size_bytes,
           disposition, file_id
         ) VALUES (?, ?, ?, 'same-copy.bin', 'application/octet-stream', 3,
                   'attachment', ?)`,
      ).bind(
        "88888888-8888-4888-8888-888888888888",
        "44444444-4444-4444-8444-444444444444",
        secondFile.object_key,
        secondFile.id,
      ),
    ]);

    await backfillAttachmentFileMd5(app, firstFile);
    await backfillAttachmentFileMd5(app, secondFile);

    const attachments = await env.DB.prepare(
      `SELECT file_id, object_key, md5 FROM message_attachments ORDER BY id`,
    ).all<{ file_id: string; object_key: string; md5: string }>();
    expect(new Set(attachments.results.map((row) => row.file_id))).toEqual(
      new Set([firstFile.id]),
    );
    expect(new Set(attachments.results.map((row) => row.object_key))).toEqual(
      new Set([firstFile.object_key]),
    );
    expect(new Set(attachments.results.map((row) => row.md5))).toEqual(
      new Set(["5289df737df57326fcdd22597afb1fac"]),
    );
    await expect(
      env.DB.prepare(
        "SELECT COUNT(*) AS count FROM attachment_files",
      ).first<number>("count"),
    ).resolves.toBe(1);
    expect(await app.attachmentStore.head(firstFile.object_key)).not.toBeNull();
    expect(await app.attachmentStore.head(secondFile.object_key)).toBeNull();
  });

  it("deletes shared bytes only after the final message reference is removed", async () => {
    const app = context();
    const fileId = "55555555-5555-4555-8555-555555555555";
    const objectKey = "attachments/shared";
    await app.attachmentStore.put(objectKey, new Uint8Array([1, 2, 3]), {});
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO attachment_files (
           id, object_key, dedupe_key, md5, size_bytes
         ) VALUES (?, ?, 'shared:3', '5289df737df57326fcdd22597afb1fac', 3)`,
      ).bind(fileId, objectKey),
      ...[
        [
          "77777777-7777-4777-8777-777777777777",
          "33333333-3333-4333-8333-333333333333",
        ],
        [
          "88888888-8888-4888-8888-888888888888",
          "44444444-4444-4444-8444-444444444444",
        ],
      ].map(([id, messageId]) =>
        env.DB.prepare(
          `INSERT INTO message_attachments (
             id, message_id, object_key, filename, mime_type, size_bytes,
             disposition, file_id, md5
           ) VALUES (?, ?, ?, 'shared.bin', 'application/octet-stream', 3,
                     'attachment', ?, '5289df737df57326fcdd22597afb1fac')`,
        ).bind(id, messageId, objectKey, fileId),
      ),
    ]);

    await env.DB.prepare("DELETE FROM messages WHERE id = ?")
      .bind("33333333-3333-4333-8333-333333333333")
      .run();
    await deleteAttachmentFileIfUnreferenced(app, fileId);
    expect(await app.attachmentStore.head(objectKey)).not.toBeNull();

    await env.DB.prepare("DELETE FROM messages WHERE id = ?")
      .bind("44444444-4444-4444-8444-444444444444")
      .run();
    await deleteAttachmentFileIfUnreferenced(app, fileId);
    expect(await app.attachmentStore.head(objectKey)).toBeNull();
    await expect(
      env.DB.prepare(
        "SELECT COUNT(*) AS count FROM attachment_files",
      ).first<number>("count"),
    ).resolves.toBe(0);
  });
});
