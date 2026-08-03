import { describe, expect, it } from "vitest";
import { MEMBER_PERMISSIONS } from "@unimailbox/contracts";
import { assertPermission } from "../../src/modules/administration";

describe("administration permission boundary", () => {
  it("requires the exact declared permission", () => {
    const principal = {
      userId: "user",
      email: "member@example.com",
      permissions: new Set(MEMBER_PERMISSIONS),
    };

    expect(() => assertPermission(principal, "message.read")).not.toThrow();
    expect(() => assertPermission(principal, "attachment.read")).not.toThrow();
    expect(() => assertPermission(principal, "message.read_all")).toThrowError(
      /message.read_all/,
    );
    expect(() => assertPermission(principal, "user.manage")).toThrowError(
      /user.manage/,
    );
  });
});
