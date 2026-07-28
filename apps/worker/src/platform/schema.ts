import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: text("created_at").notNull().default("CURRENT_TIMESTAMP"),
  updatedAt: text("updated_at").notNull().default("CURRENT_TIMESTAMP"),
};

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  passwordAlgorithm: text("password_algorithm").notNull(),
  passwordSalt: text("password_salt").notNull(),
  passwordIterations: integer("password_iterations").notNull(),
  status: text("status").notNull(),
  displayName: text("display_name").notNull(),
  ...timestamps,
});

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    refreshTokenHash: text("refresh_token_hash").notNull().unique(),
    expiresAt: text("expires_at").notNull(),
    revokedAt: text("revoked_at"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: text("created_at").notNull().default("CURRENT_TIMESTAMP"),
  },
  (table) => ({
    userIndex: index("idx_sessions_user").on(table.userId),
    expiryIndex: index("idx_sessions_expiry").on(table.expiresAt),
  }),
);

export const idempotencyRecords = sqliteTable(
  "idempotency_records",
  {
    id: text("id").primaryKey(),
    actorUserId: text("actor_user_id").notNull(),
    operation: text("operation").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    resourceId: text("resource_id"),
    responseStatus: integer("response_status").notNull(),
    responseJson: text("response_json").notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull().default("CURRENT_TIMESTAMP"),
  },
  (table) => ({
    actorOperationKey: uniqueIndex("uq_idempotency_actor_operation_key").on(
      table.actorUserId,
      table.operation,
      table.idempotencyKey,
    ),
    expiryIndex: index("idx_idempotency_records_expiry").on(table.expiresAt),
  }),
);

export const roles = sqliteTable("roles", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description").notNull(),
  isSystem: integer("is_system", { mode: "boolean" }).notNull(),
  ...timestamps,
});

export const permissions = sqliteTable("permissions", {
  key: text("key").primaryKey(),
  description: text("description").notNull(),
});

export const rolePermissions = sqliteTable(
  "role_permissions",
  {
    roleId: text("role_id").notNull(),
    permissionKey: text("permission_key").notNull(),
  },
  (table) => ({
    rolePermissionKey: primaryKey({
      columns: [table.roleId, table.permissionKey],
    }),
  }),
);

export const userRoles = sqliteTable(
  "user_roles",
  {
    userId: text("user_id").notNull(),
    roleId: text("role_id").notNull(),
  },
  (table) => ({
    userRoleKey: primaryKey({ columns: [table.userId, table.roleId] }),
  }),
);

export const encryptedCredentials = sqliteTable("encrypted_credentials", {
  id: text("id").primaryKey(),
  encryptedPayload: text("encrypted_payload").notNull(),
  encryptionVersion: integer("encryption_version").notNull(),
  ...timestamps,
});

export const providerConnections = sqliteTable(
  "provider_connections",
  {
    id: text("id").primaryKey(),
    providerKey: text("provider_key").notNull(),
    label: text("label").notNull(),
    credentialId: text("credential_id").notNull().unique(),
    status: text("status").notNull(),
    configJson: text("config_json").notNull(),
    lastHealthCheckAt: text("last_health_check_at"),
    lastHealthError: text("last_health_error"),
    ...timestamps,
  },
  (table) => ({
    keyLabel: uniqueIndex("uq_provider_connections_key_label").on(
      table.providerKey,
      table.label,
    ),
    keyStatus: index("idx_provider_connections_key").on(
      table.providerKey,
      table.status,
    ),
  }),
);

export const domains = sqliteTable("domains", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  status: text("status").notNull(),
  outboundConnectionId: text("outbound_connection_id"),
  ...timestamps,
});

export const mailboxes = sqliteTable(
  "mailboxes",
  {
    id: text("id").primaryKey(),
    domainId: text("domain_id").notNull(),
    ownerUserId: text("owner_user_id").notNull(),
    address: text("address").notNull().unique(),
    displayName: text("display_name").notNull(),
    status: text("status").notNull(),
    ...timestamps,
  },
  (table) => ({
    ownerIndex: index("idx_mailboxes_owner").on(table.ownerUserId),
    domainIndex: index("idx_mailboxes_domain").on(table.domainId),
  }),
);

export const mailboxMembers = sqliteTable(
  "mailbox_members",
  {
    mailboxId: text("mailbox_id").notNull(),
    userId: text("user_id").notNull(),
    role: text("role").notNull(),
    ...timestamps,
  },
  (table) => ({
    mailboxUserKey: primaryKey({
      columns: [table.mailboxId, table.userId],
    }),
    userIndex: index("idx_mailbox_members_user").on(table.userId),
  }),
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id"),
    fromAddress: text("from_address").notNull(),
    fromName: text("from_name").notNull(),
    subject: text("subject").notNull(),
    htmlBody: text("html_body").notNull(),
    textBody: text("text_body").notNull(),
    messageIdHeader: text("message_id_header"),
    inReplyToHeader: text("in_reply_to_header"),
    referencesHeader: text("references_header").notNull(),
    providerKey: text("provider_key"),
    providerConnectionId: text("provider_connection_id"),
    providerMessageId: text("provider_message_id"),
    status: text("status").notNull(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    rawObjectKey: text("raw_object_key"),
    createdByUserId: text("created_by_user_id"),
    sentAt: text("sent_at"),
    receivedAt: text("received_at"),
    ...timestamps,
  },
  (table) => ({
    providerIdentity: uniqueIndex("uq_messages_provider_identity").on(
      table.providerConnectionId,
      table.providerMessageId,
    ),
    threadIndex: index("idx_messages_thread").on(table.threadId),
    statusIndex: index("idx_messages_status").on(table.status),
    createdIndex: index("idx_messages_created_at").on(table.createdAt),
  }),
);

export const outboundJobs = sqliteTable(
  "outbound_jobs",
  {
    id: text("id").primaryKey(),
    messageId: text("message_id").notNull().unique(),
    status: text("status").notNull(),
    attempts: integer("attempts").notNull(),
    availableAt: text("available_at").notNull(),
    lockToken: text("lock_token"),
    lockExpiresAt: integer("lock_expires_at"),
    lastError: text("last_error"),
    ...timestamps,
  },
  (table) => ({
    dispatchIndex: index("idx_outbound_jobs_dispatch").on(
      table.status,
      table.availableAt,
    ),
  }),
);

export const messageRecipients = sqliteTable(
  "message_recipients",
  {
    id: text("id").primaryKey(),
    messageId: text("message_id").notNull(),
    type: text("type").notNull(),
    address: text("address").notNull(),
    displayName: text("display_name").notNull(),
  },
  (table) => ({
    messageIndex: index("idx_message_recipients_message").on(table.messageId),
    addressIndex: index("idx_message_recipients_address").on(table.address),
  }),
);

export const mailboxMessages = sqliteTable(
  "mailbox_messages",
  {
    id: text("id").primaryKey(),
    mailboxId: text("mailbox_id").notNull(),
    messageId: text("message_id").notNull(),
    folder: text("folder").notNull(),
    createdAt: text("created_at").notNull().default("CURRENT_TIMESTAMP"),
  },
  (table) => ({
    mailboxMessageFolder: uniqueIndex("uq_mailbox_messages_folder").on(
      table.mailboxId,
      table.messageId,
      table.folder,
    ),
    pageIndex: index("idx_mailbox_messages_page").on(
      table.mailboxId,
      table.folder,
      table.createdAt,
      table.id,
    ),
  }),
);

export const messageUserState = sqliteTable(
  "message_user_state",
  {
    mailboxMessageId: text("mailbox_message_id").notNull(),
    userId: text("user_id").notNull(),
    isRead: integer("is_read", { mode: "boolean" }).notNull(),
    isStarred: integer("is_starred", { mode: "boolean" }).notNull(),
    deletedAt: text("deleted_at"),
    updatedAt: text("updated_at").notNull().default("CURRENT_TIMESTAMP"),
  },
  (table) => ({
    mailboxUserStateKey: primaryKey({
      columns: [table.mailboxMessageId, table.userId],
    }),
  }),
);

export const attachmentUploads = sqliteTable(
  "attachment_uploads",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    objectKey: text("object_key").notNull().unique(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    disposition: text("disposition").notNull(),
    status: text("status").notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull().default("CURRENT_TIMESTAMP"),
    consumedAt: text("consumed_at"),
  },
  (table) => ({
    cleanupIndex: index("idx_attachment_uploads_cleanup").on(
      table.status,
      table.expiresAt,
    ),
  }),
);

export const messageAttachments = sqliteTable(
  "message_attachments",
  {
    id: text("id").primaryKey(),
    messageId: text("message_id").notNull(),
    uploadId: text("upload_id").unique(),
    objectKey: text("object_key").notNull(),
    filename: text("filename"),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    disposition: text("disposition").notNull(),
    contentId: text("content_id"),
    sha256: text("sha256"),
    createdAt: text("created_at").notNull().default("CURRENT_TIMESTAMP"),
  },
  (table) => ({
    messageIndex: index("idx_message_attachments_message").on(table.messageId),
    objectIndex: index("idx_message_attachments_object").on(table.objectKey),
  }),
);

export const domainSignatures = sqliteTable("domain_signatures", {
  id: text("id").primaryKey(),
  domainId: text("domain_id").notNull().unique(),
  htmlContent: text("html_content").notNull(),
  textContent: text("text_content").notNull(),
  isEnabled: integer("is_enabled", { mode: "boolean" }).notNull(),
  ...timestamps,
});

export const registrationKeys = sqliteTable("registration_keys", {
  id: text("id").primaryKey(),
  codeHash: text("code_hash").notNull().unique(),
  roleId: text("role_id"),
  maxUses: integer("max_uses").notNull(),
  usedCount: integer("used_count").notNull(),
  expiresAt: text("expires_at"),
  revokedAt: text("revoked_at"),
  createdByUserId: text("created_by_user_id").notNull(),
  createdAt: text("created_at").notNull().default("CURRENT_TIMESTAMP"),
});

export const accountRecoveryCodes = sqliteTable(
  "account_recovery_codes",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    codeHash: text("code_hash").notNull().unique(),
    usedAt: text("used_at"),
    createdAt: text("created_at").notNull().default("CURRENT_TIMESTAMP"),
  },
  (table) => ({
    userIndex: index("idx_account_recovery_codes_user").on(
      table.userId,
      table.usedAt,
    ),
  }),
);

export const oauthAccounts = sqliteTable(
  "oauth_accounts",
  {
    id: text("id").primaryKey(),
    identityProvider: text("identity_provider").notNull(),
    providerUserId: text("provider_user_id").notNull(),
    userId: text("user_id").notNull(),
    profileJson: text("profile_json").notNull(),
    ...timestamps,
  },
  (table) => ({
    identity: uniqueIndex("uq_oauth_identity").on(
      table.identityProvider,
      table.providerUserId,
    ),
  }),
);

export const providerMessageState = sqliteTable(
  "provider_message_state",
  {
    providerConnectionId: text("provider_connection_id").notNull(),
    providerKey: text("provider_key").notNull(),
    providerMessageId: text("provider_message_id").notNull(),
    messageId: text("message_id"),
    statusEventTime: integer("status_event_time"),
    statusRank: integer("status_rank").notNull(),
    importLockToken: text("import_lock_token"),
    importLockExpiresAt: integer("import_lock_expires_at"),
    updatedAt: text("updated_at").notNull().default("CURRENT_TIMESTAMP"),
  },
  (table) => ({
    providerMessageKey: primaryKey({
      columns: [table.providerConnectionId, table.providerMessageId],
    }),
    messageIndex: index("idx_provider_message_state_message").on(
      table.messageId,
    ),
  }),
);

export const webhookDeliveries = sqliteTable(
  "webhook_deliveries",
  {
    providerConnectionId: text("provider_connection_id").notNull(),
    providerKey: text("provider_key").notNull(),
    eventKey: text("event_key").notNull(),
    eventTime: integer("event_time").notNull(),
    processingStatus: text("processing_status").notNull(),
    attempts: integer("attempts").notNull(),
    lockToken: text("lock_token"),
    lockExpiresAt: integer("lock_expires_at"),
    errorMessage: text("error_message"),
    ...timestamps,
  },
  (table) => ({
    deliveryKey: primaryKey({
      columns: [table.providerConnectionId, table.eventKey],
    }),
    statusIndex: index("idx_webhook_deliveries_status").on(
      table.processingStatus,
      table.updatedAt,
    ),
  }),
);

export const webhookEvents = sqliteTable(
  "webhook_events",
  {
    id: text("id").primaryKey(),
    providerConnectionId: text("provider_connection_id").notNull(),
    providerKey: text("provider_key").notNull(),
    eventType: text("event_type").notNull(),
    providerMessageId: text("provider_message_id"),
    messageId: text("message_id"),
    recipient: text("recipient"),
    mappedStatus: text("mapped_status"),
    reason: text("reason"),
    payloadJson: text("payload_json").notNull(),
    createdAt: text("created_at").notNull().default("CURRENT_TIMESTAMP"),
  },
  (table) => ({
    providerTimeIndex: index("idx_webhook_events_provider_time").on(
      table.providerConnectionId,
      table.createdAt,
    ),
  }),
);

export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    actorUserId: text("actor_user_id"),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id"),
    requestId: text("request_id").notNull(),
    ipAddress: text("ip_address"),
    metadataJson: text("metadata_json").notNull(),
    createdAt: text("created_at").notNull().default("CURRENT_TIMESTAMP"),
  },
  (table) => ({
    resourceIndex: index("idx_audit_events_resource").on(
      table.resourceType,
      table.resourceId,
      table.createdAt,
    ),
    actorIndex: index("idx_audit_events_actor").on(
      table.actorUserId,
      table.createdAt,
    ),
  }),
);

export const installationState = sqliteTable("installation_state", {
  id: integer("id").primaryKey(),
  installationVersion: integer("installation_version").notNull(),
  stateVersion: integer("state_version").notNull(),
  status: text("status").notNull(),
  currentStep: text("current_step").notNull(),
  completedStepsJson: text("completed_steps_json").notNull(),
  cloudflareAccountId: text("cloudflare_account_id"),
  cloudflareZoneId: text("cloudflare_zone_id"),
  cloudflareCredentialId: text("cloudflare_credential_id"),
  claimedAt: text("claimed_at"),
  completedAt: text("completed_at"),
  updatedAt: text("updated_at").notNull().default("CURRENT_TIMESTAMP"),
});

export const maintenanceJobs = sqliteTable(
  "maintenance_jobs",
  {
    id: text("id").primaryKey(),
    jobKey: text("job_key").notNull().unique(),
    migrationName: text("migration_name").notNull(),
    status: text("status").notNull(),
    cursorJson: text("cursor_json").notNull(),
    attempts: integer("attempts").notNull(),
    lockToken: text("lock_token"),
    lockExpiresAt: integer("lock_expires_at"),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull().default("CURRENT_TIMESTAMP"),
    updatedAt: text("updated_at").notNull().default("CURRENT_TIMESTAMP"),
    completedAt: text("completed_at"),
  },
  (table) => ({
    runnableIndex: index("idx_maintenance_jobs_runnable").on(
      table.status,
      table.updatedAt,
    ),
  }),
);

export const systemSettings = sqliteTable("system_settings", {
  id: integer("id").primaryKey(),
  siteTitle: text("site_title").notNull(),
  registrationEnabled: integer("registration_enabled", {
    mode: "boolean",
  }).notNull(),
  inviteRequired: integer("invite_required", { mode: "boolean" }).notNull(),
  inboundEnabled: integer("inbound_enabled", { mode: "boolean" }).notNull(),
  outboundEnabled: integer("outbound_enabled", { mode: "boolean" }).notNull(),
  unknownRecipientPolicy: text("unknown_recipient_policy").notNull(),
  maxMailboxesPerUser: integer("max_mailboxes_per_user").notNull(),
  maxAttachmentsPerMessage: integer("max_attachments_per_message").notNull(),
  maxAttachmentBytes: integer("max_attachment_bytes").notNull(),
  senderBlocklistJson: text("sender_blocklist_json").notNull(),
  subjectBlocklistJson: text("subject_blocklist_json").notNull(),
  contentBlocklistJson: text("content_blocklist_json").notNull(),
  ...timestamps,
});
