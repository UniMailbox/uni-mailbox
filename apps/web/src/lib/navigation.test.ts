import { beforeEach, describe, expect, it, vi } from "vitest";
import { navigate, usePathname } from "./navigation";
import { renderHook, act } from "@testing-library/react";

describe("navigation helpers", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
  });

  it("navigates by pushing state and dispatching a popstate event", () => {
    const listener = vi.fn();
    window.addEventListener("popstate", listener);
    navigate("/inbox");
    expect(window.location.pathname).toBe("/inbox");
    expect(listener).toHaveBeenCalled();
    window.removeEventListener("popstate", listener);
  });

  it("does not push duplicate history entries for the same path", () => {
    window.history.replaceState({}, "", "/inbox");
    const before = window.history.length;
    navigate("/inbox");
    expect(window.history.length).toBe(before);
  });

  it("exposes the current pathname via the usePathname hook", () => {
    window.history.replaceState({}, "", "/login");
    const { result } = renderHook(() => usePathname());
    expect(result.current).toBe("/login");
  });

  it("updates the pathname when the history changes", () => {
    window.history.replaceState({}, "", "/login");
    const { result } = renderHook(() => usePathname());
    expect(result.current).toBe("/login");
    act(() => {
      window.history.replaceState({}, "", "/inbox");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(result.current).toBe("/inbox");
  });
});