import { describe, expect, it } from "vitest";
import {
  ADMIN_RESOURCE_PERMISSIONS,
  ADMINISTRATOR_PERMISSIONS,
  MEMBER_PERMISSIONS,
  PERMISSION_KEYS,
  adminConsoleEntryResource,
  canOpenAdminConsole,
  type AdminResourceKey,
} from "../src";

describe("administration console permission map", () => {
  it("covers every console resource the web client can route to", () => {
    // The web router derives its `/admin/<segment>` allow-list from this map,
    // so a new console page without an entry here is a routing hole.
    expect(Object.keys(ADMIN_RESOURCE_PERMISSIONS).sort()).toEqual([
      "analytics",
      "attachments",
      "audit-events",
      "domains",
      "messages",
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
    expect(adminConsoleEntryResource(ADMINISTRATOR_PERMISSIONS)).toBe("users");
  });

  it("opens the mailbox-scoped attachment catalog for a plain member", () => {
    expect(canOpenAdminConsole(MEMBER_PERMISSIONS)).toBe(true);
    expect(adminConsoleEntryResource(MEMBER_PERMISSIONS)).toBe("attachments");
    expect(MEMBER_PERMISSIONS).toContain("attachment.read");
    expect(MEMBER_PERMISSIONS).not.toContain("message.read_all");
  });

  it("grants the console to a principal holding a single console permission", () => {
    const resource: AdminResourceKey = "webhook-events";
    expect(canOpenAdminConsole([ADMIN_RESOURCE_PERMISSIONS[resource]])).toBe(
      true,
    );
  });

  it("denies the console when no permissions are held at all", () => {
    expect(canOpenAdminConsole([])).toBe(false);
    expect(adminConsoleEntryResource([])).toBeNull();
  });
});
