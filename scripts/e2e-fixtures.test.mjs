import { expect, it } from "vitest";
import { ApiErrorEnvelopeSchema } from "../packages/contracts/src/api/common/envelope.ts";
import { draftEndpoints } from "../packages/contracts/src/api/drafts.ts";
import {
  MessageAttachmentSchema,
  MessageDetailSchema,
} from "../packages/contracts/src/api/messages.ts";
import {
  composeAttachmentFixture,
  composeDraftFixture,
  replyMessageFixture,
} from "../e2e/fixtures/mail.ts";
import { seedLocalePreference } from "../e2e/fixtures/locale.ts";
import { anonymousSessionError } from "../e2e/fixtures/session.ts";

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
