import { MEMBER_PERMISSIONS, type Principal } from "@unimailbox/contracts";

export function createPrincipal(overrides: Partial<Principal> = {}): Principal {
  return {
    userId: "63f9c510-00c3-48b6-95f8-cda4ef3439f0",
    email: "member@example.com",
    permissions: new Set(MEMBER_PERMISSIONS),
    ...overrides,
  };
}

export function fixedClock(iso = "2026-07-27T00:00:00.000Z") {
  return {
    now: () => new Date(iso),
  };
}
