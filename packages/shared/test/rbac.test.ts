import { describe, expect, it } from "vitest";
import { hasPermission, isRole, requirePermission } from "../src/rbac";

describe("rbac", () => {
  it("recognizes supported roles", () => {
    expect(isRole("viewer")).toBe(true);
    expect(isRole("owner")).toBe(false);
  });

  it("allows editors to write profiles", () => {
    expect(hasPermission("editor", "profile:write")).toBe(true);
  });

  it("rejects viewer config management", () => {
    expect(() => requirePermission("viewer", "config:manage")).toThrow();
  });
});
