import { describe, expect, it } from "vitest";
import { DEFAULT_AFTER_LOGIN, safeLoginTarget } from "./app/router";

describe("application route shell", () => {
  it("never accepts an authentication route as a post-login destination", () => {
    expect(safeLoginTarget("/login?next=/admin/users")).toBe(DEFAULT_AFTER_LOGIN);
    expect(safeLoginTarget("/register")).toBe(DEFAULT_AFTER_LOGIN);
  });
});
