import {
  DomainError,
  type MailboxRole,
  type Principal,
} from "@unimailbox/contracts";
import type { Env } from "../../platform/config";
import {
  assertMailboxOperation,
  type MailboxAccessRepository,
  type MailboxOperation,
} from "../authorization";

const RESERVED_LOCAL_PARTS = new Set([
  "abuse",
  "admin",
  "hostmaster",
  "mailer-daemon",
  "postmaster",
  "root",
  "security",
]);

export class MailboxApplicationService implements MailboxAccessRepository {
  constructor(private readonly env: Env) {}

  async findAccess(
    userId: string,
    mailboxId: string,
  ): Promise<{ role: string } | null> {
    const access = await this.env.DB.prepare(
      `SELECT CASE
         WHEN owner_user_id = ? THEN 'owner'
         ELSE (SELECT role FROM mailbox_members
               WHERE mailbox_id = mailboxes.id AND user_id = ?)
       END AS role
       FROM mailboxes
       WHERE id = ? AND status != 'deleted'`,
    )
      .bind(userId, userId, mailboxId)
      .first<{ role: string | null }>();
    return access?.role ? { role: access.role } : null;
  }

  assert(
    userId: string,
    mailboxId: string,
    operation: MailboxOperation,
  ): Promise<void> {
    return assertMailboxOperation(this, userId, mailboxId, operation);
  }

  async list(principal: Principal) {
    const result = await this.env.DB.prepare(
      `SELECT m.id, m.address, m.display_name, m.status, m.domain_id,
              CASE WHEN m.owner_user_id = ? THEN 'owner' ELSE mm.role END AS role
       FROM mailboxes m
       LEFT JOIN mailbox_members mm
         ON mm.mailbox_id = m.id AND mm.user_id = ?
       WHERE m.owner_user_id = ? OR mm.user_id = ?
       ORDER BY m.address`,
    )
      .bind(
        principal.userId,
        principal.userId,
        principal.userId,
        principal.userId,
      )
      .all();
    return result.results;
  }

  async create(
    principal: Principal,
    input: { localPart: string; domainId: string; displayName: string },
  ) {
    if (!principal.permissions.has("mailbox.create")) {
      throw new DomainError(
        "PERMISSION_DENIED",
        "Permission mailbox.create is required",
        403,
      );
    }
    const localPart = input.localPart.trim().toLowerCase();
    if (RESERVED_LOCAL_PARTS.has(localPart)) {
      throw new DomainError(
        "MAILBOX_LOCAL_PART_RESERVED",
        "This mailbox local part is reserved",
        409,
      );
    }
    const domain = await this.env.DB.prepare(
      "SELECT id, name FROM domains WHERE id = ? AND status = 'active'",
    )
      .bind(input.domainId)
      .first<{ id: string; name: string }>();
    if (!domain) {
      throw new DomainError(
        "DOMAIN_NOT_ACTIVE",
        "The managed domain is not active",
        409,
      );
    }
    const quota = await this.env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM mailboxes
          WHERE owner_user_id = ? AND status != 'deleted') AS current_count,
         max_mailboxes_per_user AS maximum
       FROM system_settings WHERE id = 1`,
    )
      .bind(principal.userId)
      .first<{ current_count: number; maximum: number }>();
    if (!quota || quota.current_count >= quota.maximum) {
      throw new DomainError(
        "MAILBOX_QUOTA_EXCEEDED",
        "The mailbox quota has been reached",
        409,
      );
    }
    const mailbox = {
      id: crypto.randomUUID(),
      domainId: domain.id,
      address: `${localPart}@${domain.name.toLowerCase()}`,
      displayName: input.displayName,
    };
    try {
      await this.env.DB.prepare(
        `INSERT INTO mailboxes (
           id, domain_id, owner_user_id, address, display_name, status
         ) VALUES (?, ?, ?, ?, ?, 'active')`,
      )
        .bind(
          mailbox.id,
          mailbox.domainId,
          principal.userId,
          mailbox.address,
          mailbox.displayName,
        )
        .run();
    } catch {
      throw new DomainError(
        "MAILBOX_ADDRESS_CONFLICT",
        "This mailbox address already exists",
        409,
      );
    }
    return mailbox;
  }

  async get(principal: Principal, mailboxId: string) {
    await this.assert(principal.userId, mailboxId, "read");
    const mailbox = await this.env.DB.prepare(
      `SELECT id, domain_id, owner_user_id, address, display_name, status,
              created_at, updated_at
       FROM mailboxes WHERE id = ?`,
    )
      .bind(mailboxId)
      .first();
    if (!mailbox) {
      throw new DomainError("MAILBOX_NOT_FOUND", "Mailbox not found", 404);
    }
    return mailbox;
  }

  async rename(principal: Principal, mailboxId: string, displayName: string) {
    await this.assert(principal.userId, mailboxId, "rename");
    await this.env.DB.prepare(
      `UPDATE mailboxes
       SET display_name = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'active'`,
    )
      .bind(displayName, mailboxId)
      .run();
    return this.get(principal, mailboxId);
  }

  async remove(principal: Principal, mailboxId: string): Promise<void> {
    await this.assert(principal.userId, mailboxId, "delete_mailbox");
    await this.env.DB.prepare(
      `UPDATE mailboxes
       SET status = 'deleted', updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
      .bind(mailboxId)
      .run();
  }

  async listMembers(principal: Principal, mailboxId: string) {
    await this.assert(principal.userId, mailboxId, "read");
    const result = await this.env.DB.prepare(
      `SELECT mm.user_id, u.email, u.display_name, mm.role, mm.created_at
       FROM mailbox_members mm
       JOIN users u ON u.id = mm.user_id
       WHERE mm.mailbox_id = ?
       ORDER BY u.email`,
    )
      .bind(mailboxId)
      .all();
    return result.results;
  }

  async upsertMember(
    principal: Principal,
    mailboxId: string,
    userId: string,
    role: MailboxRole,
  ) {
    await this.assert(principal.userId, mailboxId, "manage_members");
    const mailbox = await this.env.DB.prepare(
      "SELECT owner_user_id FROM mailboxes WHERE id = ?",
    )
      .bind(mailboxId)
      .first<{ owner_user_id: string }>();
    if (!mailbox) {
      throw new DomainError("MAILBOX_NOT_FOUND", "Mailbox not found", 404);
    }
    if (mailbox.owner_user_id === userId) {
      throw new DomainError(
        "MAILBOX_OWNER_MEMBERSHIP_INVALID",
        "The mailbox owner cannot be added as a member",
        409,
      );
    }
    await this.env.DB.batch([
      this.env.DB.prepare(
        `INSERT INTO mailbox_members (mailbox_id, user_id, role)
         VALUES (?, ?, ?)
         ON CONFLICT(mailbox_id, user_id) DO UPDATE
         SET role = excluded.role, updated_at = CURRENT_TIMESTAMP`,
      ).bind(mailboxId, userId, role),
      this.env.DB.prepare(
        `INSERT INTO audit_events (
           id, actor_user_id, action, resource_type, resource_id,
           request_id, metadata_json
         ) VALUES (?, ?, 'mailbox.member.changed', 'mailbox', ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        principal.userId,
        mailboxId,
        crypto.randomUUID(),
        JSON.stringify({ userId, role }),
      ),
    ]);
    return { mailboxId, userId, role };
  }

  async removeMember(
    principal: Principal,
    mailboxId: string,
    userId: string,
  ): Promise<void> {
    if (principal.userId !== userId) {
      await this.assert(principal.userId, mailboxId, "manage_members");
    }
    await this.env.DB.prepare(
      "DELETE FROM mailbox_members WHERE mailbox_id = ? AND user_id = ?",
    )
      .bind(mailboxId, userId)
      .run();
  }
}
