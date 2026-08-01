import { describe, expect, it } from "vitest";
import {
  ADMIN_RESOURCE_PERMISSIONS,
  ADMINISTRATOR_PERMISSIONS,
  MEMBER_PERMISSIONS,
  PERMISSION_KEYS,
  canOpenAdminConsole,
  type AdminResourceKey,
} from "../src";

describe("administration console permission map", () => {
  it("covers every console resource the web client can route to", () => {
    // The web router derives its `/admin/<segment>` allow-list from this map,
    // so a new console page without an entry here is a routing hole.
    expect(Object.keys(ADMIN_RESOURCE_PERMISSIONS).sort()).toEqual([
      "analytics",
      "audit-events",
      "domains",
      "provider-connections",
      "roles",
      "settings",
      "signatures",
      "users",
      "webhook-events",
    ]);
  });

  it("only maps to permissions the Worker actually knows", () => {
    for (const permission of Object.values(ADMIN_RESOURCE_PERMISSIONS)) {
      expect(PERMISSION_KEYS).toContain(permission);
    }
  });

  it("lets an administrator open the console", () => {
    expect(canOpenAdminConsole(ADMINISTRATOR_PERMISSIONS)).toBe(true);
  });

  it("keeps a plain member out of the console", () => {
    // MEMBER_PERMISSIONS is mailbox/message scoped only. If this ever starts
    // returning true, a member gained an administration read permission and the
    // console gate needs re-reviewing.
    expect(canOpenAdminConsole(MEMBER_PERMISSIONS)).toBe(false);
  });

  it("grants the console to a principal holding a single console permission", () => {
    const resource: AdminResourceKey = "webhook-events";
    expect(canOpenAdminConsole([ADMIN_RESOURCE_PERMISSIONS[resource]])).toBe(
      true,
    );
  });

  it("denies the console when no permissions are held at all", () => {
    expect(canOpenAdminConsole([])).toBe(false);
  });
});
