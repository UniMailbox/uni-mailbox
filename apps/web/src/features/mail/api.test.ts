import { describe, expect, it, vi } from "vitest";
import type { QueryClient } from "@tanstack/react-query";
import {
  attachmentUploadCompleteMutationOptions,
  draftSendMutationOptions,
  mailboxCreateMutationOptions,
  mailboxMemberMutationOptions,
  mailKeys,
  messageMoveMutationOptions,
  messageStarMutationOptions,
  messagesInfiniteQueryOptions,
} from "./api";

const mailboxId = "11111111-1111-4111-8111-111111111111";
const messageId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const attachmentId = "44444444-4444-4444-8444-444444444444";

function queryClient() {
  return {
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
  } as unknown as QueryClient;
}

describe("mail query keys and mutations", () => {
  it("normalizes message search before constructing a stable list key", () => {
    expect(
      mailKeys.messages({
        mailboxId: "mailbox-1",
        folder: "inbox",
        search: "  urgent  ",
      }),
    ).toEqual(["mail", "messages", "mailbox-1", "inbox", "urgent"]);
  });

  it("uses the normalized message input for its infinite query key", () => {
    expect(
      messagesInfiniteQueryOptions({
        mailboxId,
        folder: "starred",
        search: "  urgent  ",
      }).queryKey,
    ).toEqual(["mail", "messages", mailboxId, "starred", "urgent"]);
  });

  it("star invalidates the message detail and every message list", async () => {
    const client = queryClient();
    const options = messageStarMutationOptions(client);
    await options.onSuccess?.(
      { updated: true },
      { messageId, isStarred: true },
      undefined,
      undefined as never,
    );
    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: mailKeys.message(messageId),
    });
    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: mailKeys.messagesRoot(),
    });
  });

  it("move invalidates source, destination, and message detail", async () => {
    const client = queryClient();
    const options = messageMoveMutationOptions(client);
    await options.onSuccess?.(
      { updated: true, folder: "archive" },
      { messageId, mailboxId, sourceFolder: "inbox", folder: "archive" },
      undefined,
      undefined as never,
    );
    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: mailKeys.messages({ mailboxId, folder: "inbox" }),
    });
    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: mailKeys.messages({ mailboxId, folder: "archive" }),
    });
    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: mailKeys.message(messageId),
    });
  });

  it("sending a draft invalidates sent messages and drafts", async () => {
    const client = queryClient();
    const options = draftSendMutationOptions(client);
    await options.onSuccess?.(
      { messageId, status: "sent" },
      {
        draftId: messageId,
        mailboxId,
        ifMatch: '"version"',
        idempotencyKey: "request-1",
      },
      undefined,
      undefined as never,
    );
    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: mailKeys.messagesRoot(),
    });
    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: mailKeys.drafts(),
    });
  });

  it("upload completion invalidates attachment lists", async () => {
    const client = queryClient();
    const options = attachmentUploadCompleteMutationOptions(client);
    await options.onSuccess?.(
      { attachmentId, status: "uploaded" },
      { attachmentId, messageId },
      undefined,
      undefined as never,
    );
    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: mailKeys.attachmentsRoot(),
    });
    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: mailKeys.messageAttachments(messageId),
    });
  });

  it("mailbox and member writes invalidate canonical mailbox keys", async () => {
    const client = queryClient();
    const created = mailboxCreateMutationOptions(client);
    await created.onSuccess?.(
      {
        id: mailboxId,
        domainId: mailboxId,
        address: "ops@example.com",
        displayName: "Operations",
      },
      { localPart: "ops", domainId: mailboxId, displayName: "Operations" },
      undefined,
      undefined as never,
    );
    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: mailKeys.mailboxes(),
    });

    const members = mailboxMemberMutationOptions(client);
    await members.onSuccess?.(
      { mailboxId, userId, role: "sender" },
      { action: "add", mailboxId, userId, role: "sender" },
      undefined,
      undefined as never,
    );
    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: mailKeys.mailboxMembers(mailboxId),
    });
    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: mailKeys.mailboxes(),
    });
  });
});
