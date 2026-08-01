import { create } from "zustand";
import {
  resolveInitialTimeZone,
  TIME_ZONE_STORAGE_KEY,
} from "../i18n/timezone";
import {
  applyThemeColor,
  resolveInitialThemeColor,
  THEME_COLOR_STORAGE_KEY,
} from "./theme";

export interface ComposeIntent {
  draftId?: string;
  parentMessageId?: string;
}

interface UiState {
  selectedMailboxId: string | null;
  composeOpen: boolean;
  composeIntent: ComposeIntent | null;
  sidebarOpen: boolean;
  themeColor: string;
  timeZone: string;
  setSelectedMailboxId(id: string): void;
  setComposeOpen(open: boolean, intent?: ComposeIntent): void;
  setSidebarOpen(open: boolean): void;
  setThemeColor(themeColor: string): void;
  setTimeZone(timeZone: string): void;
}

export const useUiStore = create<UiState>((set) => ({
  selectedMailboxId: window.localStorage.getItem("unimailbox.mailbox"),
  composeOpen: false,
  composeIntent: null,
  sidebarOpen: false,
  themeColor: resolveInitialThemeColor(
    window.localStorage.getItem(THEME_COLOR_STORAGE_KEY),
  ),
  timeZone: resolveInitialTimeZone(
    window.localStorage.getItem(TIME_ZONE_STORAGE_KEY),
  ),
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
  setThemeColor: (themeColor) => {
    const normalized = applyThemeColor(themeColor);
    window.localStorage.setItem(THEME_COLOR_STORAGE_KEY, normalized);
    set({ themeColor: normalized });
  },
  setTimeZone: (timeZone) => {
    window.localStorage.setItem(TIME_ZONE_STORAGE_KEY, timeZone);
    set({ timeZone });
  },
}));
