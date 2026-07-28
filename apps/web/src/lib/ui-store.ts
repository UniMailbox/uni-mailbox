import { create } from "zustand";

export interface ComposeIntent {
  draftId?: string;
  parentMessageId?: string;
}

interface UiState {
  selectedMailboxId: string | null;
  composeOpen: boolean;
  composeIntent: ComposeIntent | null;
  sidebarOpen: boolean;
  setSelectedMailboxId(id: string): void;
  setComposeOpen(open: boolean, intent?: ComposeIntent): void;
  setSidebarOpen(open: boolean): void;
}

export const useUiStore = create<UiState>((set) => ({
  selectedMailboxId: window.localStorage.getItem("unimailbox.mailbox"),
  composeOpen: false,
  composeIntent: null,
  sidebarOpen: false,
  setSelectedMailboxId: (selectedMailboxId) => {
    window.localStorage.setItem("unimailbox.mailbox", selectedMailboxId);
    set({ selectedMailboxId });
  },
  setComposeOpen: (composeOpen, composeIntent) =>
    set({
      composeOpen,
      composeIntent: composeOpen ? (composeIntent ?? null) : null,
    }),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
}));
