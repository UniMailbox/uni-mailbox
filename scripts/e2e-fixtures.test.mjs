import { expect, it } from "vitest";
import { ApiErrorEnvelopeSchema } from "../packages/contracts/src/api/common/envelope.ts";
import { attachmentEndpoints } from "../packages/contracts/src/api/attachments.ts";
import { authEndpoints } from "../packages/contracts/src/api/auth.ts";
import { draftEndpoints } from "../packages/contracts/src/api/drafts.ts";
import {
  MessageAttachmentSchema,
  MessageDetailSchema,
} from "../packages/contracts/src/api/messages.ts";
import {
  composeAttachmentFixture,
  composeCreateUploadFixture,
  composeDraftFixture,
  replyMessageFixture,
} from "../e2e/fixtures/mail.ts";
import {
  initializeProjectLocale,
  seedLocalePreference,
} from "../e2e/fixtures/locale.ts";
import {
  anonymousSessionError,
  sessionProfile,
} from "../e2e/fixtures/session.ts";

it("keeps the Compose attachment and draft mocks contract-valid", () => {
  expect(MessageAttachmentSchema.parse(composeAttachmentFixture)).toEqual(
    composeAttachmentFixture,
  );
  const draft = composeDraftFixture({
    id: "22222222-2222-4222-8222-222222222222",
    mailboxId: "11111111-1111-4111-8111-111111111111",
    updatedAt: "2026-07-27T01:00:00.000Z",
  });
  expect(draftEndpoints.create.responses[201].parse(draft)).toEqual(draft);

  const upload = composeCreateUploadFixture(
    "http://127.0.0.1:5186/api/v1/attachments/uploads",
  );
  expect(upload.status).toBe(201);
  expect(
    attachmentEndpoints.createUpload.responses[201].parse(upload.body),
  ).toEqual(upload.body);
});

it("keeps the reply mock contract-valid", () => {
  expect(MessageDetailSchema.parse(replyMessageFixture)).toEqual(
    replyMessageFixture,
  );
});

it("uses a contract-valid anonymous session envelope", () => {
  expect(ApiErrorEnvelopeSchema.parse(anonymousSessionError)).toEqual(
    anonymousSessionError,
  );
  const profile = sessionProfile(["settings.manage"]);
  expect(authEndpoints.session.responses[200].parse(profile)).toEqual(profile);
});

it("seeds a project locale only when a preference does not already exist", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };

  seedLocalePreference("en", storage);
  seedLocalePreference("zh-CN", storage);

  expect(storage.getItem("unimailbox.locale")).toBe("en");
});

it("registers the project locale initializer on the browser context", async () => {
  const calls = [];
  const context = {
    addInitScript: async (...args) => calls.push(args),
  };

  await initializeProjectLocale(context, "zh-CN");

  expect(calls).toHaveLength(1);
  expect(calls[0]?.[1]).toBe("zh-CN");
});
