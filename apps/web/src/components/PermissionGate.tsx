import { hasPermission, type Permission, type Role } from "@cf-startup/shared";
import type { ReactNode } from "react";

type PermissionGateProps = {
  role: Role;
  permission: Permission;
  children: ReactNode;
  fallback?: ReactNode;
};

export function PermissionGate({ role, permission, children, fallback = null }: PermissionGateProps) {
  return hasPermission(role, permission) ? children : fallback;
}
