import { DomainError } from "@unimailbox/contracts";

export type MailboxOperation =
  | "read"
  | "send"
  | "rename"
  | "manage_members"
  | "delete_message"
  | "delete_mailbox";

export interface MailboxAccessRepository {
  findAccess(
    userId: string,
    mailboxId: string,
  ): Promise<{ role: string } | null>;
}

const roleOperations: Record<string, ReadonlySet<MailboxOperation>> = {
  owner: new Set([
    "read",
    "send",
    "rename",
    "manage_members",
    "delete_message",
    "delete_mailbox",
  ]),
  viewer: new Set(["read"]),
  sender: new Set(["read", "send"]),
  admin: new Set(["read", "send", "rename", "manage_members"]),
};

export async function assertMailboxOperation(
  repository: MailboxAccessRepository,
  userId: string,
  mailboxId: string,
  operation: MailboxOperation,
): Promise<void> {
  const access = await repository.findAccess(userId, mailboxId);
  if (!access || !roleOperations[access.role]?.has(operation)) {
    throw new DomainError(
      "MAILBOX_PERMISSION_DENIED",
      "The operation is not permitted for this mailbox",
      403,
    );
  }
}
