import { MessageDetailSchema } from "../packages/contracts/src/api/messages.ts";
import { expect, it } from "vitest";
import { messageDetailFixture } from "../e2e/fixtures/message-detail.ts";

it("keeps the message-detail E2E mock contract-valid", () => {
  expect(MessageDetailSchema.parse(messageDetailFixture)).toEqual(
    messageDetailFixture,
  );
});
