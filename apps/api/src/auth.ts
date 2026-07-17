import { isRole, type Permission, rolePermissions } from "@cf-startup/shared";
import type { Context, MiddlewareHandler } from "hono";
import { fail } from "./http";
import type { Env } from "./types";

export const attachPrincipal: MiddlewareHandler<Env> = async (c, next) => {
  const roleHeader = c.req.header("x-user-role");
  const role = isRole(roleHeader) ? roleHeader : "viewer";
  const id = c.req.header("x-user-id") ?? "anonymous";

  c.set("principal", { id, role });
  await next();
};

export function can(permission: Permission): MiddlewareHandler<Env> {
  return async (c, next) => {
    const principal = c.get("principal");

    if (!rolePermissions[principal.role].includes(permission)) {
      return fail("forbidden", "You do not have permission to access this resource.", 403);
    }

    await next();
  };
}

export function currentSession(c: Context<Env>) {
  const principal = c.get("principal");
  return {
    principal,
    role: principal.role,
    permissions: rolePermissions[principal.role]
  };
}
