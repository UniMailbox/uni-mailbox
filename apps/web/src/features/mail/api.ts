import {
  infiniteQueryOptions,
  mutationOptions,
  queryOptions,
  type QueryClient,
} from "@tanstack/react-query";
import {
  attachmentEndpoints,
  draftEndpoints,
  mailboxEndpoints,
  messageEndpoints,
  type EndpointRequest,
} from "@unimailbox/contracts";
import { apiClient } from "../../lib/api/index";

export type MailFolder =
  | "inbox"
  | "sent"
  | "drafts"
  | "starred"
  | "archive"
  | "trash";

type MessageListInput = {
  mailboxId: string;
  folder: MailFolder;
  search?: string;
};

function normalizeMessageListInput(input: MessageListInput) {
  return {
    mailboxId: input.mailboxId.trim(),
    folder: input.folder,
    search: input.search?.trim() ?? "",
  } as const;
}

export const mailKeys = {
  all: ["mail"] as const,
  mailboxes: () => [...mailKeys.all, "mailboxes"] as const,
  mailbox: (mailboxId: string) =>
    [...mailKeys.mailboxes(), mailboxId.trim()] as const,
  mailboxMembers: (mailboxId: string) =>
    [...mailKeys.mailbox(mailboxId), "members"] as const,
  messagesRoot: () => [...mailKeys.all, "messages"] as const,
  messages: (input: MessageListInput) => {
    const normalized = normalizeMessageListInput(input);
    return [
      ...mailKeys.messagesRoot(),
      normalized.mailboxId,
      normalized.folder,
      normalized.search,
    ] as const;
  },
  message: (messageId: string) =>
    [...mailKeys.all, "message", messageId.trim()] as const,
  drafts: () => [...mailKeys.all, "drafts"] as const,
  draft: (draftId: string) => [...mailKeys.drafts(), draftId.trim()] as const,
  attachmentsRoot: () => [...mailKeys.all, "attachments"] as const,
  messageAttachments: (messageId: string) =>
    [...mailKeys.attachmentsRoot(), "message", messageId.trim()] as const,
};

export function mailboxesQueryOptions() {
  return queryOptions({
    queryKey: mailKeys.mailboxes(),
    queryFn: () => apiClient.request(mailboxEndpoints.list, {}),
  });
}

export function messagesInfiniteQueryOptions(input: MessageListInput) {
  const normalized = normalizeMessageListInput(input);
  const folder = normalized.folder === "starred" ? "inbox" : normalized.folder;
  return infiniteQueryOptions({
    queryKey: mailKeys.messages(normalized),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      apiClient.request(messageEndpoints.list, {
        params: { mailboxId: normalized.mailboxId },
        query: {
          folder,
          limit: 50,
          ...(pageParam ? { cursor: pageParam } : {}),
          ...(normalized.folder === "starred" ? { starred: true } : {}),
        },
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}

export function messageQueryOptions(messageId: string) {
  return queryOptions({
    queryKey: mailKeys.message(messageId),
    queryFn: () =>
      apiClient.request(messageEndpoints.get, { params: { messageId } }),
  });
}

export function messageAttachmentsQueryOptions(messageId: string) {
  return queryOptions({
    queryKey: mailKeys.messageAttachments(messageId),
    queryFn: () =>
      apiClient.request(messageEndpoints.listAttachments, {
        params: { messageId },
      }),
  });
}

export function draftsQueryOptions() {
  return queryOptions({
    queryKey: mailKeys.drafts(),
    queryFn: () => apiClient.request(draftEndpoints.list, {}),
  });
}

export function draftQueryOptions(draftId: string) {
  return queryOptions({
    queryKey: mailKeys.draft(draftId),
    queryFn: () =>
      apiClient.request(draftEndpoints.get, { params: { draftId } }),
  });
}

async function invalidateMessageLists(client: QueryClient): Promise<void> {
  await client.invalidateQueries({ queryKey: mailKeys.messagesRoot() });
}

export function messageStarMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: (input: { messageId: string; isStarred: boolean }) =>
      apiClient.request(messageEndpoints.star, {
        params: { messageId: input.messageId },
        body: { isStarred: input.isStarred },
      }),
    onSuccess: async (_result, input) => {
      await queryClient.invalidateQueries({
        queryKey: mailKeys.message(input.messageId),
      });
      await invalidateMessageLists(queryClient);
    },
  });
}

export function messageMoveMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: (input: {
      messageId: string;
      mailboxId: string;
      sourceFolder?: MailFolder;
      folder: "inbox" | "archive" | "trash";
    }) =>
      apiClient.request(messageEndpoints.move, {
        params: { messageId: input.messageId },
        body: { mailboxId: input.mailboxId, folder: input.folder },
      }),
    onSuccess: async (_result, input) => {
      if (input.sourceFolder) {
        await queryClient.invalidateQueries({
          queryKey: mailKeys.messages({
            mailboxId: input.mailboxId,
            folder: input.sourceFolder,
          }),
        });
      } else {
        await invalidateMessageLists(queryClient);
      }
      await queryClient.invalidateQueries({
        queryKey: mailKeys.messages({
          mailboxId: input.mailboxId,
          folder: input.folder,
        }),
      });
      await queryClient.invalidateQueries({
        queryKey: mailKeys.message(input.messageId),
      });
    },
  });
}

export function messageSendMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: (input: EndpointRequest<typeof messageEndpoints.send>) =>
      apiClient.request(messageEndpoints.send, input),
    onSuccess: async () => invalidateMessageLists(queryClient),
  });
}

export function draftCreateMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: (body: EndpointRequest<typeof draftEndpoints.create>["body"]) =>
      apiClient.request(draftEndpoints.create, { body }),
    onSuccess: async () =>
      queryClient.invalidateQueries({ queryKey: mailKeys.drafts() }),
  });
}

export function draftUpdateMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: (input: EndpointRequest<typeof draftEndpoints.update>) =>
      apiClient.request(draftEndpoints.update, input),
    onSuccess: async (_result, input) => {
      await queryClient.invalidateQueries({
        queryKey: mailKeys.draft(input.params.draftId),
      });
      await queryClient.invalidateQueries({ queryKey: mailKeys.drafts() });
    },
  });
}

export function draftSendMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: (input: {
      draftId: string;
      mailboxId: string;
      ifMatch: string;
      idempotencyKey: string;
    }) =>
      apiClient.request(draftEndpoints.send, {
        params: { draftId: input.draftId },
        headers: {
          "if-match": input.ifMatch,
          "idempotency-key": input.idempotencyKey,
        },
      }),
    onSuccess: async (_result, input) => {
      await queryClient.invalidateQueries({
        queryKey: mailKeys.draft(input.draftId),
      });
      await queryClient.invalidateQueries({ queryKey: mailKeys.drafts() });
      await queryClient.invalidateQueries({
        queryKey: mailKeys.messages({
          mailboxId: input.mailboxId,
          folder: "sent",
        }),
      });
      await invalidateMessageLists(queryClient);
    },
  });
}

export function attachmentUploadCompleteMutationOptions(
  queryClient: QueryClient,
) {
  return mutationOptions({
    mutationFn: (input: { attachmentId: string; messageId?: string }) =>
      apiClient.request(attachmentEndpoints.completeUpload, {
        params: { attachmentId: input.attachmentId },
      }),
    onSuccess: async (_result, input) => {
      await queryClient.invalidateQueries({
        queryKey: mailKeys.attachmentsRoot(),
      });
      if (input.messageId)
        await queryClient.invalidateQueries({
          queryKey: mailKeys.messageAttachments(input.messageId),
        });
    },
  });
}

export function attachmentDownloadMutationOptions() {
  return mutationOptions({
    mutationFn: (attachment: { id: string; filename: string | null }) =>
      apiClient.request(attachmentEndpoints.download, {
        params: { attachmentId: attachment.id },
      }),
  });
}

export function mailboxCreateMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: (
      body: EndpointRequest<typeof mailboxEndpoints.create>["body"],
    ) => apiClient.request(mailboxEndpoints.create, { body }),
    onSuccess: async () =>
      queryClient.invalidateQueries({ queryKey: mailKeys.mailboxes() }),
  });
}

export function mailboxMemberMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: (input: {
      action: "add" | "update" | "remove";
      mailboxId: string;
      userId: string;
      role?: "viewer" | "sender" | "admin";
    }) => {
      if (input.action === "remove")
        return apiClient.request(mailboxEndpoints.removeMember, {
          params: { mailboxId: input.mailboxId, userId: input.userId },
        });
      if (input.action === "add")
        return apiClient.request(mailboxEndpoints.addMember, {
          params: { mailboxId: input.mailboxId },
          body: { userId: input.userId, role: input.role! },
        });
      return apiClient.request(mailboxEndpoints.updateMember, {
        params: { mailboxId: input.mailboxId, userId: input.userId },
        body: { role: input.role! },
      });
    },
    onSuccess: async (_result, input) => {
      await queryClient.invalidateQueries({
        queryKey: mailKeys.mailboxMembers(input.mailboxId),
      });
      await queryClient.invalidateQueries({ queryKey: mailKeys.mailboxes() });
    },
  });
}
