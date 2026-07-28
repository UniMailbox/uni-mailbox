import { beforeEach, describe, expect, it } from "vitest";
import { useUiStore } from "./ui-store";

describe("ui-store", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useUiStore.setState({
      selectedMailboxId: null,
      composeOpen: false,
      composeIntent: null,
      sidebarOpen: false,
    });
  });

  it("updates the selected mailbox id and persists it", () => {
    useUiStore.getState().setSelectedMailboxId("mailbox-1");
    expect(useUiStore.getState().selectedMailboxId).toBe("mailbox-1");
    expect(window.localStorage.getItem("unimailbox.mailbox")).toBe(
      "mailbox-1",
    );
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
});