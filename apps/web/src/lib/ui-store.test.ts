import { beforeEach, describe, expect, it } from "vitest";
import { useUiStore } from "./ui-store";
import { TIME_ZONE_STORAGE_KEY } from "../i18n/timezone";
import {
  applyThemeColor,
  DEFAULT_THEME_COLOR,
  THEME_COLOR_STORAGE_KEY,
} from "./theme";

describe("ui-store", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useUiStore.setState({
      selectedMailboxId: null,
      composeOpen: false,
      composeIntent: null,
      sidebarOpen: false,
      themeColor: DEFAULT_THEME_COLOR,
      timeZone: "UTC",
    });
    applyThemeColor(DEFAULT_THEME_COLOR);
  });

  it("updates the selected mailbox id and persists it", () => {
    useUiStore.getState().setSelectedMailboxId("mailbox-1");
    expect(useUiStore.getState().selectedMailboxId).toBe("mailbox-1");
    expect(window.localStorage.getItem("unimailbox.mailbox")).toBe("mailbox-1");
  });

  it("opens the composer with intent and clears intent when closed", () => {
    const { setComposeOpen } = useUiStore.getState();
    setComposeOpen(true, { draftId: "d1", parentMessageId: "m1" });
    expect(useUiStore.getState()).toMatchObject({
      composeOpen: true,
      composeIntent: { draftId: "d1", parentMessageId: "m1" },
    });
    setComposeOpen(false);
    expect(useUiStore.getState()).toMatchObject({
      composeOpen: false,
      composeIntent: null,
    });
  });

  it("clears the composer intent when no new intent is provided while opening", () => {
    const { setComposeOpen } = useUiStore.getState();
    setComposeOpen(true, { draftId: "d1" });
    setComposeOpen(true);
    expect(useUiStore.getState().composeIntent).toBeNull();
  });

  it("toggles the sidebar state", () => {
    useUiStore.getState().setSidebarOpen(true);
    expect(useUiStore.getState().sidebarOpen).toBe(true);
    useUiStore.getState().setSidebarOpen(false);
    expect(useUiStore.getState().sidebarOpen).toBe(false);
  });

  it("updates and persists the selected time zone", () => {
    useUiStore.getState().setTimeZone("Asia/Singapore");
    expect(useUiStore.getState().timeZone).toBe("Asia/Singapore");
    expect(window.localStorage.getItem(TIME_ZONE_STORAGE_KEY)).toBe(
      "Asia/Singapore",
    );
  });

  it("updates, applies, and persists the selected theme color", () => {
    useUiStore.getState().setThemeColor("#2563EB");

    expect(useUiStore.getState().themeColor).toBe("#2563eb");
    expect(window.localStorage.getItem(THEME_COLOR_STORAGE_KEY)).toBe(
      "#2563eb",
    );
    expect(
      document.documentElement.style.getPropertyValue("--theme-color"),
    ).toBe("#2563eb");
  });
});
