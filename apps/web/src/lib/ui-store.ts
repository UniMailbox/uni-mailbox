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

const SIDEBAR_COLLAPSED_STORAGE_KEY = "unimailbox.sidebarCollapsed";
const EXPANDED_GROUPS_STORAGE_KEY = "unimailbox.sidebarExpandedGroups";

function readCollapsedPreference(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function readExpandedGroups(): string[] {
  try {
    const raw = window.localStorage.getItem(EXPANDED_GROUPS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === "string");
  } catch {
    return [];
  }
}

export interface ComposeIntent {
  draftId?: string;
  parentMessageId?: string;
}

interface UiState {
  selectedMailboxId: string | null;
  composeOpen: boolean;
  composeIntent: ComposeIntent | null;
  sidebarOpen: boolean;
  sidebarCollapsed: boolean;
  expandedGroups: string[];
  themeColor: string;
  timeZone: string;
  setSelectedMailboxId(id: string): void;
  setComposeOpen(open: boolean, intent?: ComposeIntent): void;
  setSidebarOpen(open: boolean): void;
  setSidebarCollapsed(collapsed: boolean): void;
  toggleSidebarCollapsed(): void;
  setGroupExpanded(groupId: string, expanded: boolean): void;
  toggleGroupExpanded(groupId: string): void;
  setThemeColor(themeColor: string): void;
  setTimeZone(timeZone: string): void;
}

export const useUiStore = create<UiState>((set, get) => ({
  selectedMailboxId: window.localStorage.getItem("unimailbox.mailbox"),
  composeOpen: false,
  composeIntent: null,
  sidebarOpen: false,
  sidebarCollapsed: readCollapsedPreference(),
  expandedGroups: readExpandedGroups(),
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
  setSidebarCollapsed: (sidebarCollapsed) => {
    window.localStorage.setItem(
      SIDEBAR_COLLAPSED_STORAGE_KEY,
      sidebarCollapsed ? "1" : "0",
    );
    set({ sidebarCollapsed });
  },
  toggleSidebarCollapsed: () => {
    const next = !get().sidebarCollapsed;
    window.localStorage.setItem(
      SIDEBAR_COLLAPSED_STORAGE_KEY,
      next ? "1" : "0",
    );
    set({ sidebarCollapsed: next });
  },
  setGroupExpanded: (groupId, expanded) => {
    const current = get().expandedGroups;
    const has = current.includes(groupId);
    if (expanded && !has) {
      const next = [...current, groupId];
      window.localStorage.setItem(
        EXPANDED_GROUPS_STORAGE_KEY,
        JSON.stringify(next),
      );
      set({ expandedGroups: next });
      return;
    }
    if (!expanded && has) {
      const next = current.filter((id) => id !== groupId);
      window.localStorage.setItem(
        EXPANDED_GROUPS_STORAGE_KEY,
        JSON.stringify(next),
      );
      set({ expandedGroups: next });
    }
  },
  toggleGroupExpanded: (groupId) => {
    const current = get().expandedGroups;
    const next = current.includes(groupId)
      ? current.filter((id) => id !== groupId)
      : [...current, groupId];
    window.localStorage.setItem(
      EXPANDED_GROUPS_STORAGE_KEY,
      JSON.stringify(next),
    );
    set({ expandedGroups: next });
  },
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
