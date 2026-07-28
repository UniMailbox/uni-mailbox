import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyD1Migrations, env } from "cloudflare:test";
import {
  ADMINISTRATOR_PERMISSIONS,
  type Principal,
} from "@unimailbox/contracts";
import { AttachmentApplicationService } from "../../src/modules/attachments";
import { UploadTokenCodec } from "../../src/modules/attachments/upload-token";
import { createAttachmentStore } from "../../src/platform/attachment-store";
import type { Env } from "../../src/platform/config";

const principal: Principal = {
  userId: "11111111-1111-4111-8111-111111111111",
  email: "owner@example.com",
  permissions: new Set(ADMINISTRATOR_PERMISSIONS),
};

function makeEnv(withoutR2: boolean): Env {
  const record = env as unknown as Record<string, unknown>;
  const base: Env = {
    DB: env.DB,
    KV: env.KV,
    OUTBOUND_QUEUE: env.OUTBOUND_QUEUE,
    ASSETS: {} as Fetcher,
    INSTALLATION_TOKEN: "x".repeat(32),
    AUTH_SIGNING_KEY: "x".repeat(32),
    CREDENTIAL_ENCRYPTION_KEY: "e".repeat(32),
  };
  if (!withoutR2 && record.ATTACHMENTS) {
    base.ATTACHMENTS = record.ATTACHMENTS as R2Bucket;
  }
  return base;
}

function attachmentService(withoutR2: boolean) {
  const e = makeEnv(withoutR2);
  return new AttachmentApplicationService(
    e,
    new UploadTokenCodec("k".repeat(32)),
    createAttachmentStore(e),
  );
}

describe("AttachmentApplicationService.create size guard", () => {
  beforeEach(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
    await env.DB.prepare(
      `INSERT INTO users (
         id, email, password_hash, password_salt, password_iterations,
         display_name
       ) VALUES (?, 'owner@example.com', 'h', 's', 1, 'Owner')`,
    )
      .bind(principal.userId)
      .run();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  it("rejects uploads at or above the KV backend limit", async () => {
    const service = attachmentService(true);
    await expect(
      service.create(
        principal,
        {
          filename: "huge.bin",
          contentType: "application/octet-stream",
          size: 25 * 1024 * 1024,
          disposition: "attachment",
        },
        "https://mail.example/api/v1/attachments/uploads",
      ),
    ).rejects.toMatchObject({
      code: "ATTACHMENT_TOO_LARGE",
      status: 413,
    });
  });

  it("accepts uploads just below the KV backend limit", async () => {
    const service = attachmentService(true);
    const created = await service.create(
      principal,
      {
        filename: "almost-huge.bin",
        contentType: "application/octet-stream",
        size: 25 * 1024 * 1024 - 1,
        disposition: "attachment",
      },
      "https://mail.example/api/v1/attachments/uploads",
    );
    expect(created.objectKey).toMatch(/^attachments\//u);
    expect(created.transport).toBe("worker-kv-binding");
  });

  it("uses the R2 transport label when ATTACHMENTS is bound", async () => {
    const record = env as unknown as Record<string, unknown>;
    if (!record.ATTACHMENTS) {
      // The local worker pool may have KV only; skip rather than fail.
      return;
    }
    const service = attachmentService(false);
    const created = await service.create(
      principal,
      {
        filename: "small.bin",
        contentType: "application/octet-stream",
        size: 16,
        disposition: "attachment",
      },
      "https://mail.example/api/v1/attachments/uploads",
    );
    expect(created.transport).toBe("worker-r2-binding");
  });
});
