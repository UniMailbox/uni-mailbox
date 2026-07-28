import { describe, expect, it } from "vitest";
import {
  assertMailboxOperation,
  type MailboxAccessRepository,
  type MailboxOperation,
} from "../../src/modules/authorization";

const allowed: Record<string, readonly MailboxOperation[]> = {
  owner: [
    "read",
    "send",
    "rename",
    "manage_members",
    "delete_message",
    "delete_mailbox",
  ],
  viewer: ["read"],
  sender: ["read", "send"],
  admin: ["read", "send", "rename", "manage_members"],
};

describe("mailbox role matrix", () => {
  for (const [role, operations] of Object.entries(allowed)) {
    it(`enforces ${role} access`, async () => {
      const repository: MailboxAccessRepository = {
        findAccess: async () => ({ role }),
      };
      const everyOperation: MailboxOperation[] = [
        "read",
        "send",
        "rename",
        "manage_members",
        "delete_message",
        "delete_mailbox",
      ];

      for (const operation of everyOperation) {
        if (operations.includes(operation)) {
          await expect(
            assertMailboxOperation(repository, "user", "mailbox", operation),
          ).resolves.toBeUndefined();
        } else {
          await expect(
            assertMailboxOperation(repository, "user", "mailbox", operation),
          ).rejects.toMatchObject({
            code: "MAILBOX_PERMISSION_DENIED",
            status: 403,
          });
        }
      }
    });
  }

  it("denies access when no target-mailbox relation exists", async () => {
    const repository: MailboxAccessRepository = {
      findAccess: async () => null,
    };

    await expect(
      assertMailboxOperation(repository, "user", "mailbox", "read"),
    ).rejects.toMatchObject({ code: "MAILBOX_PERMISSION_DENIED" });
  });
});
