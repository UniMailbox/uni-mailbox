import type { Principal } from "@cf-startup/shared";

export async function writeAudit(
  db: D1Database,
  principal: Principal,
  action: string,
  resource: string
): Promise<void> {
  await db
    .prepare("INSERT INTO audit_events (id, actor_id, action, resource) VALUES (?, ?, ?, ?)")
    .bind(crypto.randomUUID(), principal.id, action, resource)
    .run();
}
