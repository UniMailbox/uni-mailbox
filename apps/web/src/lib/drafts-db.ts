import Dexie, { type EntityTable } from "dexie";
import type { ComposeDraft } from "@unimailbox/contracts";

interface WorkingDraft extends ComposeDraft {
  serverDraftId?: string;
}

class UniMailboxDb extends Dexie {
  workingDrafts!: EntityTable<WorkingDraft, "id">;

  constructor() {
    super("unimailbox");
    this.version(1).stores({
      workingDrafts: "id, mailboxId, serverDraftId, updatedAt",
    });
  }
}

export const draftsDb = new UniMailboxDb();
