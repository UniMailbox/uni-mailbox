export const roles = ["viewer", "editor", "admin"] as const;
export type Role = (typeof roles)[number];

export const permissions = [
  "profile:read",
  "profile:write",
  "file:read",
  "file:write",
  "config:manage"
] as const;
export type Permission = (typeof permissions)[number];

export type Principal = {
  id: string;
  role: Role;
};

export const rolePermissions: Record<Role, readonly Permission[]> = {
  viewer: ["profile:read", "file:read"],
  editor: ["profile:read", "profile:write", "file:read", "file:write"],
  admin: ["profile:read", "profile:write", "file:read", "file:write", "config:manage"]
};

export function isRole(value: string | null | undefined): value is Role {
  return roles.includes(value as Role);
}

export function hasPermission(role: Role, permission: Permission): boolean {
  return rolePermissions[role].includes(permission);
}

export function requirePermission(role: Role, permission: Permission): void {
  if (!hasPermission(role, permission)) {
    throw new Error(`Role ${role} does not have ${permission}`);
  }
}
