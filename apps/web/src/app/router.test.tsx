import { describe, expect, it } from "vitest";
import { safeLoginTarget } from "./router";

describe("safe post-login destinations", () => {
  it.each([
    ["/admin/roles", "/admin/roles"],
    ["/messages/123?view=full", "/messages/123?view=full"],
    ["https://evil.example", "/inbox"],
    ["//evil.example", "/inbox"],
    ["/\\evil.example", "/inbox"],
    ["/admin\\users", "/inbox"],
    ["/login", "/inbox"],
    ["/register", "/inbox"],
  ])("maps %s to %s", (input, expected) => {
    expect(safeLoginTarget(input)).toBe(expected);
  });
});
