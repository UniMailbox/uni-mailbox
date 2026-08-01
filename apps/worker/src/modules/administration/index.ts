import {
  DomainError,
  PERMISSION_KEYS,
  statusRank,
  type PermissionKey,
  type Principal,
  type ProviderMessageDetail,
} from "@unimailbox/contracts";
import { runtimePolicy } from "@unimailbox/config";
import type { AppContext } from "../../app-context";
import { parseProviderKey } from "@unimailbox/contracts";
import { PasswordService, normalizeEmail } from "../identity";
import { sanitizeSignatureHtml } from "../signatures";
import { shouldApplyProviderStatus } from "../provider-sync";

type AdminContext = Pick<
  AppContext,
  "env" | "providers" | "credentials" | "logger"
>;

export function assertPermission(
  principal: Principal,
  permission: PermissionKey,
): void {
  if (!principal.permissions.has(permission)) {
    throw new DomainError(
      "PERMISSION_DENIED",
      `Permission ${permission} is required`,
      403,
    );
  }
}

function isPermission(value: string): value is PermissionKey {
  return (PERMISSION_KEYS as readonly string[]).includes(value);
}

export class AdminApplicationService {
  private readonly passwords = new PasswordService();

  constructor(private readonly context: AdminContext) {}

  async listUsers(principal: Principal) {
    assertPermission(principal, "user.read");
    const result = await this.context.env.DB.prepare(
      `SELECT u.id, u.email, u.display_name, u.status, u.created_at,
              GROUP_CONCAT(r.name) AS roles
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN roles r ON r.id = ur.role_id
       GROUP BY u.id
       ORDER BY u.created_at DESC`,
    ).all();
    return result.results;
  }

  async createUser(
    principal: Principal,
    input: {
      email: string;
      password: string;
      displayName: string;
      roleIds: string[];
    },
  ) {
    assertPermission(principal, "user.manage");
    const record = await this.passwords.hash(input.password);
    const userId = crypto.randomUUID();
    const statements = [
      this.context.env.DB.prepare(
        `INSERT INTO users (
           id, email, password_hash, password_algorithm, password_salt,
           password_iterations, status, display_name
         ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`,
      ).bind(
        userId,
        normalizeEmail(input.email),
        record.hash,
        record.algorithm,
        record.salt,
        record.iterations,
        input.displayName,
      ),
      ...input.roleIds.map((roleId) =>
        this.context.env.DB.prepare(
          "INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)",
        ).bind(userId, roleId),
      ),
    ];
    try {
      await this.context.env.DB.batch(statements);
    } catch {
      throw new DomainError(
        "USER_CREATE_CONFLICT",
        "The user could not be created with these roles",
        409,
      );
    }
    return { id: userId, email: normalizeEmail(input.email) };
  }

  async updateUser(
    principal: Principal,
    userId: string,
    input: {
      displayName?: string;
      status?: "active" | "suspended";
      roleIds?: string[];
    },
  ) {
    assertPermission(principal, "user.manage");
    const statements: D1PreparedStatement[] = [
      this.context.env.DB.prepare(
        `UPDATE users
         SET display_name = COALESCE(?, display_name),
             status = COALESCE(?, status),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status != 'deleted'`,
      ).bind(input.displayName ?? null, input.status ?? null, userId),
    ];
    if (input.roleIds) {
      statements.push(
        this.context.env.DB.prepare(
          "DELETE FROM user_roles WHERE user_id = ?",
        ).bind(userId),
        ...input.roleIds.map((roleId) =>
          this.context.env.DB.prepare(
            "INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)",
          ).bind(userId, roleId),
        ),
      );
    }
    if (input.status === "suspended") {
      statements.push(
        this.context.env.DB.prepare(
          `UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP
           WHERE user_id = ? AND revoked_at IS NULL`,
        ).bind(userId),
      );
    }
    await this.context.env.DB.batch(statements);
    return { id: userId, ...input };
  }

  async deleteUser(principal: Principal, userId: string): Promise<void> {
    assertPermission(principal, "user.manage");
    if (principal.userId === userId) {
      throw new DomainError(
        "USER_SELF_DELETE_FORBIDDEN",
        "Administrators cannot delete their active account",
        409,
      );
    }
    await this.context.env.DB.batch([
      this.context.env.DB.prepare(
        `UPDATE users
         SET status = 'deleted', updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      ).bind(userId),
      this.context.env.DB.prepare(
        `UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP
         WHERE user_id = ? AND revoked_at IS NULL`,
      ).bind(userId),
    ]);
  }

  async listRoles(principal: Principal) {
    assertPermission(principal, "role.read");
    const result = await this.context.env.DB.prepare(
      `SELECT r.id, r.name, r.description, r.is_system,
              GROUP_CONCAT(rp.permission_key) AS permissions
       FROM roles r
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
       GROUP BY r.id
       ORDER BY r.is_system DESC, r.name`,
    ).all();
    return result.results;
  }

  async createRole(
    principal: Principal,
    input: { name: string; description: string; permissions: string[] },
  ) {
    assertPermission(principal, "role.manage");
    const permissions = input.permissions.filter(isPermission);
    if (permissions.length !== new Set(input.permissions).size) {
      throw new DomainError(
        "ROLE_PERMISSION_INVALID",
        "One or more permissions are invalid",
      );
    }
    const roleId = crypto.randomUUID();
    await this.context.env.DB.batch([
      this.context.env.DB.prepare(
        `INSERT INTO roles (id, name, description, is_system)
         VALUES (?, ?, ?, 0)`,
      ).bind(roleId, input.name.trim(), input.description),
      ...permissions.map((permission) =>
        this.context.env.DB.prepare(
          `INSERT INTO role_permissions (role_id, permission_key)
           VALUES (?, ?)`,
        ).bind(roleId, permission),
      ),
    ]);
    return { id: roleId, ...input, permissions };
  }

  async updateRole(
    principal: Principal,
    roleId: string,
    input: { description: string; permissions: string[] },
  ) {
    assertPermission(principal, "role.manage");
    const role = await this.context.env.DB.prepare(
      "SELECT is_system FROM roles WHERE id = ?",
    )
      .bind(roleId)
      .first<{ is_system: number }>();
    if (!role) throw new DomainError("ROLE_NOT_FOUND", "Role not found", 404);
    if (role.is_system === 1) {
      throw new DomainError(
        "SYSTEM_ROLE_IMMUTABLE",
        "System roles cannot be changed",
        409,
      );
    }
    const permissions = input.permissions.filter(isPermission);
    if (permissions.length !== new Set(input.permissions).size) {
      throw new DomainError(
        "ROLE_PERMISSION_INVALID",
        "One or more permissions are invalid",
      );
    }
    await this.context.env.DB.batch([
      this.context.env.DB.prepare(
        `UPDATE roles SET description = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      ).bind(input.description, roleId),
      this.context.env.DB.prepare(
        "DELETE FROM role_permissions WHERE role_id = ?",
      ).bind(roleId),
      ...permissions.map((permission) =>
        this.context.env.DB.prepare(
          "INSERT INTO role_permissions (role_id, permission_key) VALUES (?, ?)",
        ).bind(roleId, permission),
      ),
    ]);
    return { id: roleId, ...input, permissions };
  }

  async deleteRole(principal: Principal, roleId: string): Promise<void> {
    assertPermission(principal, "role.manage");
    const result = await this.context.env.DB.prepare(
      "DELETE FROM roles WHERE id = ? AND is_system = 0",
    )
      .bind(roleId)
      .run();
    if (result.meta.changes !== 1) {
      throw new DomainError(
        "SYSTEM_ROLE_IMMUTABLE",
        "System or missing roles cannot be deleted",
        409,
      );
    }
  }

  async listDomains(principal: Principal) {
    assertPermission(principal, "domain.read");
    const result = await this.context.env.DB.prepare(
      `SELECT d.id, d.name, d.status, d.outbound_connection_id,
              pc.provider_key, pc.label AS provider_label
       FROM domains d
       LEFT JOIN provider_connections pc ON pc.id = d.outbound_connection_id
       ORDER BY d.name`,
    ).all();
    return result.results;
  }

  async updateDomain(
    principal: Principal,
    domainId: string,
    input: {
      status?: "active" | "disabled";
      outboundConnectionId?: string | null;
    },
  ) {
    assertPermission(principal, "domain.manage");
    await this.context.env.DB.prepare(
      `UPDATE domains
       SET status = COALESCE(?, status),
           outbound_connection_id = CASE
             WHEN ? = 1 THEN ?
             ELSE outbound_connection_id
           END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
      .bind(
        input.status ?? null,
        "outboundConnectionId" in input ? 1 : 0,
        input.outboundConnectionId ?? null,
        domainId,
      )
      .run();
    return { id: domainId, ...input };
  }

  async deleteDomain(principal: Principal, domainId: string): Promise<void> {
    assertPermission(principal, "domain.manage");
    const mailboxes = await this.context.env.DB.prepare(
      `SELECT 1 FROM mailboxes
       WHERE domain_id = ? AND status != 'deleted' LIMIT 1`,
    )
      .bind(domainId)
      .first();
    if (mailboxes) {
      throw new DomainError(
        "DOMAIN_IN_USE",
        "Delete or move active mailboxes before deleting the domain",
        409,
      );
    }
    await this.context.env.DB.prepare("DELETE FROM domains WHERE id = ?")
      .bind(domainId)
      .run();
  }

  async getSettings(principal: Principal) {
    assertPermission(principal, "settings.read");
    return this.context.env.DB.prepare(
      `SELECT site_title, registration_enabled, invite_required,
              inbound_enabled, outbound_enabled, unknown_recipient_policy,
              max_mailboxes_per_user, max_attachments_per_message,
              max_attachment_bytes, sender_blocklist_json,
              subject_blocklist_json, content_blocklist_json
       FROM system_settings WHERE id = 1`,
    ).first();
  }

  async updateSettings(principal: Principal, input: Record<string, unknown>) {
    assertPermission(principal, "settings.manage");
    const allowed = new Set([
      "site_title",
      "registration_enabled",
      "invite_required",
      "inbound_enabled",
      "outbound_enabled",
      "unknown_recipient_policy",
      "max_mailboxes_per_user",
      "max_attachments_per_message",
      "max_attachment_bytes",
      "sender_blocklist_json",
      "subject_blocklist_json",
      "content_blocklist_json",
    ]);
    const entries = Object.entries(input).filter(([key]) => allowed.has(key));
    if (entries.length === 0 || entries.length !== Object.keys(input).length) {
      throw new DomainError(
        "SETTINGS_INPUT_INVALID",
        "One or more settings are not editable",
      );
    }
    for (const [key, value] of entries) {
      await this.context.env.DB.prepare(
        `UPDATE system_settings
         SET ${key} = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = 1`,
      )
        .bind(key.endsWith("_json") ? JSON.stringify(value) : value)
        .run();
    }
    return this.getSettings(principal);
  }

  async getSignature(principal: Principal, domainId: string) {
    assertPermission(principal, "signature.read");
    return (
      (await this.context.env.DB.prepare(
        `SELECT id, domain_id, html_content, text_content, is_enabled,
                updated_at
         FROM domain_signatures WHERE domain_id = ?`,
      )
        .bind(domainId)
        .first()) ?? {
        domain_id: domainId,
        html_content: "",
        text_content: "",
        is_enabled: 0,
      }
    );
  }

  async putSignature(
    principal: Principal,
    domainId: string,
    input: { html: string; text: string; enabled: boolean },
  ) {
    assertPermission(principal, "signature.manage");
    const html = sanitizeSignatureHtml(input.html);
    await this.context.env.DB.prepare(
      `INSERT INTO domain_signatures (
         id, domain_id, html_content, text_content, is_enabled
       ) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(domain_id) DO UPDATE SET
         html_content = excluded.html_content,
         text_content = excluded.text_content,
         is_enabled = excluded.is_enabled,
         updated_at = CURRENT_TIMESTAMP`,
    )
      .bind(
        crypto.randomUUID(),
        domainId,
        html,
        input.text,
        Number(input.enabled),
      )
      .run();
    return this.getSignature(principal, domainId);
  }

  async listProviderConnections(principal: Principal) {
    assertPermission(principal, "domain.read");
    const result = await this.context.env.DB.prepare(
      `SELECT id, provider_key, label, status, config_json,
              last_health_check_at, last_health_error, created_at, updated_at
       FROM provider_connections ORDER BY provider_key, label`,
    ).all();
    return result.results;
  }

  async createProviderConnection(
    principal: Principal,
    input: {
      providerKey: string;
      label: string;
      apiKey: string;
      webhookSecret: string;
      config?: Record<string, unknown>;
    },
  ) {
    assertPermission(principal, "domain.manage");
    const providerKey = parseProviderKey(input.providerKey);
    const plugin = this.context.providers.get(providerKey);
    const connectionId = crypto.randomUUID();
    const credentialId = crypto.randomUUID();
    const secrets = plugin.validateConnectionInput({
      apiKey: input.apiKey,
      webhookSecret: input.webhookSecret,
    }) as Record<string, string>;
    await plugin.outbound.validateConnection({
      connectionId,
      config: input.config ?? {},
      secrets,
    });
    await this.context.env.DB.batch([
      this.context.env.DB.prepare(
        `INSERT INTO encrypted_credentials (
           id, encrypted_payload, encryption_version
         ) VALUES (?, ?, 1)`,
      ).bind(credentialId, await this.context.credentials.encrypt(secrets)),
      this.context.env.DB.prepare(
        `INSERT INTO provider_connections (
           id, provider_key, label, credential_id, status, config_json,
           last_health_check_at
         ) VALUES (?, ?, ?, ?, 'active', ?, CURRENT_TIMESTAMP)`,
      ).bind(
        connectionId,
        providerKey,
        input.label,
        credentialId,
        JSON.stringify(input.config ?? {}),
      ),
    ]);
    return {
      id: connectionId,
      providerKey,
      label: input.label,
      status: "active",
    };
  }

  async updateProviderConnection(
    principal: Principal,
    connectionId: string,
    input: {
      status?: "active" | "disabled";
      apiKey?: string;
      webhookSecret?: string;
    },
  ) {
    assertPermission(principal, "domain.manage");
    const row = await this.context.env.DB.prepare(
      `SELECT pc.provider_key, pc.credential_id, ec.encrypted_payload
       FROM provider_connections pc
       JOIN encrypted_credentials ec ON ec.id = pc.credential_id
       WHERE pc.id = ?`,
    )
      .bind(connectionId)
      .first<{
        provider_key: string;
        credential_id: string;
        encrypted_payload: string;
      }>();
    if (!row) {
      throw new DomainError(
        "PROVIDER_CONNECTION_NOT_FOUND",
        "Provider connection not found",
        404,
      );
    }
    const statements: D1PreparedStatement[] = [
      this.context.env.DB.prepare(
        `UPDATE provider_connections
         SET status = COALESCE(?, status), updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      ).bind(input.status ?? null, connectionId),
    ];
    if (input.apiKey || input.webhookSecret) {
      const current = await this.context.credentials.decrypt(
        row.encrypted_payload,
      );
      const next = {
        ...current,
        ...(input.apiKey ? { apiKey: input.apiKey } : {}),
        ...(input.webhookSecret ? { webhookSecret: input.webhookSecret } : {}),
      };
      const plugin = this.context.providers.get(
        parseProviderKey(row.provider_key),
      );
      plugin.validateConnectionInput(next);
      statements.push(
        this.context.env.DB.prepare(
          `UPDATE encrypted_credentials
           SET encrypted_payload = ?, encryption_version = 1,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
        ).bind(await this.context.credentials.encrypt(next), row.credential_id),
      );
    }
    await this.context.env.DB.batch(statements);
    return { id: connectionId, status: input.status ?? "unchanged" };
  }

  async syncProviders(principal: Principal) {
    assertPermission(principal, "provider.sync");
    const connections = await this.context.env.DB.prepare(
      `SELECT pc.id, pc.provider_key, pc.config_json, ec.encrypted_payload
       FROM provider_connections pc
       JOIN encrypted_credentials ec ON ec.id = pc.credential_id
       WHERE pc.status = 'active'`,
    ).all<{
      id: string;
      provider_key: string;
      config_json: string;
      encrypted_payload: string;
    }>();
    const totals = { inserted: 0, updated: 0, skipped: 0, failed: 0 };
    for (const connection of connections.results) {
      const providerKey = parseProviderKey(connection.provider_key);
      const plugin = this.context.providers.get(providerKey);
      if (!plugin.sync) {
        totals.skipped += 1;
        continue;
      }
      const runtime = {
        connectionId: connection.id,
        config: JSON.parse(connection.config_json) as Record<string, unknown>,
        secrets: await this.context.credentials.decrypt(
          connection.encrypted_payload,
        ),
      };
      let cursor: string | undefined;
      for (
        let pageNumber = 0;
        pageNumber < runtimePolicy.providerSyncPageLimit;
        pageNumber += 1
      ) {
        const page = await plugin.sync.listMessages(runtime, cursor);
        for (const detail of page.items) {
          try {
            const action = await this.reconcileMessage(
              connection.id,
              providerKey,
              detail,
            );
            totals[action] += 1;
          } catch {
            totals.failed += 1;
          }
        }
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }
      this.context.logger.info("provider.sync.completed", {
        connectionId: connection.id,
        providerKey,
        ...totals,
      });
    }
    return totals;
  }

  async listWebhookEvents(principal: Principal, limit = 100) {
    assertPermission(principal, "webhook_event.read");
    const result = await this.context.env.DB.prepare(
      `SELECT id, provider_connection_id, provider_key, event_type,
              provider_message_id, message_id, recipient, mapped_status,
              reason, created_at
       FROM webhook_events
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
    )
      .bind(Math.min(500, Math.max(1, limit)))
      .all();
    return result.results;
  }

  async deleteWebhookEvent(
    principal: Principal,
    eventId: string,
  ): Promise<void> {
    assertPermission(principal, "webhook_event.delete");
    await this.context.env.DB.prepare("DELETE FROM webhook_events WHERE id = ?")
      .bind(eventId)
      .run();
  }

  async listAuditEvents(
    principal: Principal,
    input: { limit?: number; query?: string } = {},
  ) {
    assertPermission(principal, "analytics.read");
    const query = input.query?.trim().slice(0, 200) ?? "";
    const result = await this.context.env.DB.prepare(
      `SELECT id, actor_user_id, action, resource_type, resource_id,
              request_id, metadata_json, created_at
       FROM audit_events
       WHERE ? = ''
          OR action LIKE '%' || ? || '%'
          OR resource_type LIKE '%' || ? || '%'
          OR resource_id LIKE '%' || ? || '%'
          OR request_id LIKE '%' || ? || '%'
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
    )
      .bind(
        query,
        query,
        query,
        query,
        query,
        Math.min(500, Math.max(1, input.limit ?? 100)),
      )
      .all();
    return result.results;
  }

  async analytics(principal: Principal) {
    assertPermission(principal, "analytics.read");
    return this.context.env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM users WHERE status = 'active') AS active_users,
         (SELECT COUNT(*) FROM mailboxes WHERE status = 'active') AS active_mailboxes,
         (SELECT COUNT(*) FROM messages WHERE status = 'received') AS received_messages,
         (SELECT COUNT(*) FROM messages WHERE status IN ('sent', 'delivered')) AS sent_messages,
         (SELECT COUNT(*) FROM outbound_jobs WHERE status = 'failed') AS failed_jobs,
         (SELECT COUNT(*) FROM webhook_deliveries WHERE processing_status = 'failed') AS failed_webhooks`,
    ).first();
  }

  private async reconcileMessage(
    connectionId: string,
    providerKey: string,
    detail: ProviderMessageDetail,
  ): Promise<"inserted" | "updated" | "skipped"> {
    const existing = await this.context.env.DB.prepare(
      `SELECT m.id, state.status_event_time, state.status_rank
       FROM messages m
       LEFT JOIN provider_message_state state
         ON state.provider_connection_id = m.provider_connection_id
        AND state.provider_message_id = m.provider_message_id
       WHERE m.provider_connection_id = ? AND m.provider_message_id = ?`,
    )
      .bind(connectionId, detail.providerMessageId)
      .first<{
        id: string;
        status_event_time: number | null;
        status_rank: number | null;
      }>();
    const eventTime = new Date(detail.occurredAt).getTime();
    const rank = statusRank[detail.status];
    if (existing) {
      if (
        !shouldApplyProviderStatus(
          existing.status_event_time === null
            ? null
            : {
                eventTime: existing.status_event_time,
                statusRank: existing.status_rank ?? 0,
              },
          { eventTime, statusRank: rank },
        )
      ) {
        return "skipped";
      }
      await this.context.env.DB.batch([
        this.context.env.DB.prepare(
          `UPDATE messages SET status = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
        ).bind(detail.status, existing.id),
        this.context.env.DB.prepare(
          `INSERT INTO provider_message_state (
             provider_connection_id, provider_key, provider_message_id,
             message_id, status_event_time, status_rank
           ) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(provider_connection_id, provider_message_id) DO UPDATE SET
             status_event_time = excluded.status_event_time,
             status_rank = excluded.status_rank,
             updated_at = CURRENT_TIMESTAMP`,
        ).bind(
          connectionId,
          providerKey,
          detail.providerMessageId,
          existing.id,
          eventTime,
          rank,
        ),
      ]);
      return "updated";
    }
    const messageId = crypto.randomUUID();
    const senderMailbox = await this.context.env.DB.prepare(
      "SELECT id FROM mailboxes WHERE address = ? COLLATE NOCASE AND status = 'active'",
    )
      .bind(detail.from.address)
      .first<{ id: string }>();
    await this.context.env.DB.batch([
      this.context.env.DB.prepare(
        `INSERT INTO messages (
           id, thread_id, from_address, from_name, subject, html_body, text_body,
           provider_key, provider_connection_id, provider_message_id, status,
           sent_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        messageId,
        messageId,
        detail.from.address,
        detail.from.name ?? "",
        detail.subject,
        detail.html,
        detail.text,
        providerKey,
        connectionId,
        detail.providerMessageId,
        detail.status,
        detail.occurredAt.replace("T", " ").replace("Z", ""),
      ),
      this.context.env.DB.prepare(
        `INSERT INTO provider_message_state (
           provider_connection_id, provider_key, provider_message_id,
           message_id, status_event_time, status_rank
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(
        connectionId,
        providerKey,
        detail.providerMessageId,
        messageId,
        eventTime,
        rank,
      ),
      ...(senderMailbox
        ? [
            this.context.env.DB.prepare(
              `INSERT INTO mailbox_messages (id, mailbox_id, message_id, folder)
               VALUES (?, ?, ?, 'sent')`,
            ).bind(crypto.randomUUID(), senderMailbox.id, messageId),
          ]
        : []),
    ]);
    return "inserted";
  }
}
