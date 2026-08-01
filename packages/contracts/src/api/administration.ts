import { z } from "zod";
import { defineEndpoint } from "./common/endpoint";

const UuidSchema = z.string().trim().uuid();
const IdempotencyHeadersSchema = z.object({
  "idempotency-key": z.string().trim().min(1).max(255),
});
const AddressSchema = z
  .string()
  .trim()
  .email()
  .transform((value) => value.toLowerCase());
const ResourceStatusSchema = z.enum(["ok", "missing", "error"]);
const protectedErrors = [
  "AUTH_REQUIRED",
  "AUTH_TOKEN_INVALID",
  "PERMISSION_DENIED",
  "INTERNAL_ERROR",
] as const;
const idempotencyErrors = [
  "IDEMPOTENCY_KEY_REQUIRED",
  "IDEMPOTENCY_KEY_REUSED",
] as const;
const validationErrors = ["VALIDATION_FAILED"] as const;
const cloudflareVerifyErrors = [
  ...protectedErrors,
  ...idempotencyErrors,
  ...validationErrors,
  "CLOUDFLARE_API_FAILED",
  "CLOUDFLARE_OAUTH_REFRESH_FAILED",
  "CLOUDFLARE_ZONE_ACCOUNT_MISMATCH",
] as const;
const cloudflareDomainErrors = [
  ...protectedErrors,
  ...idempotencyErrors,
  ...validationErrors,
  "CLOUDFLARE_API_FAILED",
  "CLOUDFLARE_CATCH_ALL_CONFLICT",
  "CLOUDFLARE_OAUTH_REFRESH_FAILED",
  "DOMAIN_CONFLICT",
  "DOMAIN_ZONE_MISMATCH",
] as const;
const cloudflareInboundErrors = [
  ...protectedErrors,
  ...idempotencyErrors,
  ...validationErrors,
  "DOMAIN_NOT_FOUND",
  "INBOUND_SMOKE_TOKEN_INVALID",
] as const;
const cloudflareProviderErrors = [
  ...protectedErrors,
  ...idempotencyErrors,
  ...validationErrors,
  "PROVIDER_NOT_SUPPORTED",
] as const;
const cloudflareOutboundErrors = [
  ...protectedErrors,
  ...idempotencyErrors,
  "PROVIDER_CONNECTION_NOT_FOUND",
  ...validationErrors,
] as const;
const r2VerifyErrors = [
  ...protectedErrors,
  ...idempotencyErrors,
  "R2_NOT_CONFIGURED",
  "R2_VERIFICATION_FAILED",
] as const;
const adminReadErrors = [...protectedErrors] as const;
const adminMutationErrors = [
  ...protectedErrors,
  ...idempotencyErrors,
  ...validationErrors,
] as const;

export const AdminCreateSchema = z.discriminatedUnion("resource", [
  z.object({
    resource: z.literal("users"),
    email: AddressSchema,
    displayName: z.string().trim().min(1).max(120),
    password: z.string().min(12).max(1024),
    roleIds: z.array(UuidSchema).max(20),
  }),
  z.object({
    resource: z.literal("domains"),
    name: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u),
  }),
  z.object({
    resource: z.literal("roles"),
    name: z.string().trim().min(1).max(80),
    description: z.string().max(500),
    permissions: z.array(z.string()).max(100),
  }),
  z.object({
    resource: z.literal("provider-connections"),
    providerKey: z.string().min(2).max(32),
    label: z.string().trim().min(1).max(80),
    apiKey: z.string().min(8),
    webhookSecret: z.string().min(8),
    config: z.record(z.unknown()).optional(),
  }),
]);

export const AdminUpdateSchema = z.discriminatedUnion("resource", [
  z.object({
    resource: z.literal("users"),
    id: UuidSchema,
    displayName: z.string().trim().min(1).max(120).optional(),
    status: z.enum(["active", "suspended"]).optional(),
    roleIds: z.array(UuidSchema).max(20).optional(),
  }),
  z.object({
    resource: z.literal("domains"),
    id: UuidSchema,
    status: z.enum(["active", "disabled"]).optional(),
    outboundConnectionId: UuidSchema.nullable().optional(),
  }),
  z.object({
    resource: z.literal("roles"),
    id: UuidSchema,
    description: z.string().max(500),
    permissions: z.array(z.string()).max(100),
  }),
  z.object({
    resource: z.literal("provider-connections"),
    id: UuidSchema,
    status: z.enum(["active", "disabled"]).optional(),
    apiKey: z.string().min(8).optional(),
    webhookSecret: z.string().min(8).optional(),
  }),
]);

export const AdminDeleteSchema = z.discriminatedUnion("resource", [
  z.object({ resource: z.literal("users"), id: UuidSchema }),
  z.object({ resource: z.literal("roles"), id: UuidSchema }),
  z.object({ resource: z.literal("domains"), id: UuidSchema }),
  z.object({ resource: z.literal("webhook-events"), id: UuidSchema }),
]);

const UserSchema = z.object({
  id: UuidSchema,
  email: z.string(),
  display_name: z.string(),
  status: z.enum(["active", "suspended", "deleted"]),
  created_at: z.string(),
  roles: z.string().nullable(),
});
const RoleSchema = z.object({
  id: UuidSchema,
  name: z.string(),
  description: z.string(),
  is_system: z.number(),
  permissions: z.string().nullable(),
});
const DomainSchema = z.object({
  id: UuidSchema,
  name: z.string(),
  status: z.enum(["active", "disabled"]),
  outbound_connection_id: UuidSchema.nullable(),
  provider_key: z.string().nullable(),
  provider_label: z.string().nullable(),
});
const ProviderConnectionSchema = z.object({
  id: UuidSchema,
  provider_key: z.string(),
  label: z.string(),
  status: z.enum(["active", "disabled"]),
  config_json: z.string(),
  last_health_check_at: z.string().nullable(),
  last_health_error: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
const SignatureSchema = z.object({
  id: UuidSchema.optional(),
  domain_id: UuidSchema,
  html_content: z.string(),
  text_content: z.string(),
  is_enabled: z.number(),
  updated_at: z.string().optional(),
});
const SettingsSchema = z.object({
  site_title: z.string(),
  registration_enabled: z.number().int().min(0).max(1),
  invite_required: z.number().int().min(0).max(1),
  inbound_enabled: z.number().int().min(0).max(1),
  outbound_enabled: z.number().int().min(0).max(1),
  unknown_recipient_policy: z.enum(["reject", "store"]),
  max_mailboxes_per_user: z.number().int().min(1).max(1_000),
  max_attachments_per_message: z.number().int().min(1).max(100),
  max_attachment_bytes: z
    .number()
    .int()
    .min(1)
    .max(512 * 1024 * 1024),
  sender_blocklist_json: z.string(),
  subject_blocklist_json: z.string(),
  content_blocklist_json: z.string(),
});
const WebhookEventSchema = z.object({
  id: UuidSchema,
  provider_connection_id: UuidSchema,
  provider_key: z.string(),
  event_type: z.string(),
  provider_message_id: z.string().nullable(),
  message_id: UuidSchema.nullable(),
  recipient: z.string().nullable(),
  mapped_status: z.string().nullable(),
  reason: z.string().nullable(),
  created_at: z.string(),
});
const AuditEventSchema = z.object({
  id: UuidSchema,
  actor_user_id: UuidSchema.nullable(),
  action: z.string(),
  resource_type: z.string(),
  resource_id: z.string().nullable(),
  request_id: z.string().nullable(),
  metadata_json: z.string().nullable(),
  created_at: z.string(),
});
const AnalyticsSchema = z.object({
  active_users: z.number(),
  active_mailboxes: z.number(),
  received_messages: z.number(),
  sent_messages: z.number(),
  failed_jobs: z.number(),
  failed_webhooks: z.number(),
});
const limitQuery = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .default(100)
    .transform((value) => Math.min(500, value)),
});
const auditQuery = limitQuery.extend({
  q: z.string().trim().max(200).optional(),
});
const settingsUpdateSchema = SettingsSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
);

export const ConfigurationCheckpointSchema = z.object({
  checkpointKey: z.enum([
    "brevo",
    "cloudflare_mail",
    "inbound_smoke_test",
    "outbound_smoke_test",
    "r2_storage",
  ]),
  status: z.enum(["pending", "configured", "verified", "failed"]),
  metadata: z.record(z.unknown()),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  verifiedAt: z.string().nullable(),
});

export const CloudflareVerifySchema = z.object({
  accountId: z.string().trim().min(1).max(64),
  zoneId: z.string().trim().min(1).max(64),
  mode: z.enum(["dashboard", "oauth"]),
});
export const CloudflareDomainCreateSchema = z.object({
  name: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u),
});
export const CloudflareBrevoConnectSchema = z.object({
  providerKey: z.literal("brevo"),
  label: z.string().trim().min(1).max(80),
  apiKey: z.string().min(8),
  webhookSecret: z.string().min(8),
  domainId: UuidSchema,
});
export const CloudflareOutboundSmokeTestSchema = z.object({
  connectionId: UuidSchema,
  from: AddressSchema,
  to: AddressSchema,
});

const CloudflareVerificationResponseSchema = z.object({
  mode: z.enum(["dashboard", "oauth"]),
  routingVerification: z.literal("pending_inbound_smoke_test"),
  oauthVerification: z
    .object({ zoneName: z.string(), emailRoutingStatus: z.string() })
    .optional(),
});
const CloudflareDomainResponseSchema = z.object({
  id: UuidSchema,
  name: z.string(),
  expectedRoute: z.string(),
  cloudflareRouting: z
    .object({ dns: z.string(), catchAll: z.string() })
    .optional(),
});
const InboundSmokeResponseSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("awaiting_message"),
    recipient: AddressSchema.optional(),
    subject: z.string().optional(),
    token: z.string(),
  }),
  z.object({ status: z.literal("received"), messageId: UuidSchema }),
]);

export const administrationEndpoints = {
  cloudflareStatus: defineEndpoint({
    method: "GET",
    path: "/admin/cloudflare/status",
    responses: { 200: z.array(ConfigurationCheckpointSchema) },
    errors: protectedErrors,
    mediaType: "json",
  }),
  cloudflareOauthStart: defineEndpoint({
    method: "POST",
    path: "/admin/cloudflare/oauth/start",
    request: { headers: IdempotencyHeadersSchema },
    responses: { 200: z.object({ url: z.string().url() }) },
    errors: [
      ...protectedErrors,
      ...idempotencyErrors,
      "CLOUDFLARE_OAUTH_NOT_CONFIGURED",
      "CLOUDFLARE_OAUTH_HTTPS_REQUIRED",
    ],
    mediaType: "json",
  }),
  cloudflareOauthRevoke: defineEndpoint({
    method: "POST",
    path: "/admin/cloudflare/oauth/revoke",
    request: { headers: IdempotencyHeadersSchema },
    responses: { 200: z.object({ revoked: z.boolean() }) },
    errors: [
      ...protectedErrors,
      ...idempotencyErrors,
      "CLOUDFLARE_OAUTH_NOT_CONFIGURED",
      "CLOUDFLARE_OAUTH_REVOKE_FAILED",
    ],
    mediaType: "json",
  }),
  cloudflareVerify: defineEndpoint({
    method: "POST",
    path: "/admin/cloudflare/verify",
    request: {
      headers: IdempotencyHeadersSchema,
      body: CloudflareVerifySchema,
    },
    responses: { 200: CloudflareVerificationResponseSchema },
    errors: cloudflareVerifyErrors,
    mediaType: "json",
  }),
  cloudflareDomainCreate: defineEndpoint({
    method: "POST",
    path: "/admin/cloudflare/domains",
    request: {
      headers: IdempotencyHeadersSchema,
      body: CloudflareDomainCreateSchema,
    },
    responses: { 201: CloudflareDomainResponseSchema },
    errors: cloudflareDomainErrors,
    mediaType: "json",
  }),
  cloudflareInboundSmokeTest: defineEndpoint({
    method: "POST",
    path: "/admin/cloudflare/smoke-test/inbound",
    request: {
      headers: IdempotencyHeadersSchema,
      body: z.object({ token: z.string().trim().min(1).max(255).optional() }),
    },
    responses: { 200: InboundSmokeResponseSchema },
    errors: cloudflareInboundErrors,
    mediaType: "json",
  }),
  cloudflareBrevoConnect: defineEndpoint({
    method: "POST",
    path: "/admin/cloudflare/brevo",
    request: {
      headers: IdempotencyHeadersSchema,
      body: CloudflareBrevoConnectSchema,
    },
    responses: {
      201: z.object({
        connectionId: UuidSchema,
        providerKey: z.string(),
        status: z.literal("active"),
      }),
    },
    errors: cloudflareProviderErrors,
    mediaType: "json",
  }),
  cloudflareOutboundSmokeTest: defineEndpoint({
    method: "POST",
    path: "/admin/cloudflare/smoke-test/outbound",
    request: {
      headers: IdempotencyHeadersSchema,
      body: CloudflareOutboundSmokeTestSchema,
    },
    responses: {
      200: z.object({
        status: z.literal("sent"),
        providerMessageId: z.string(),
      }),
    },
    errors: cloudflareOutboundErrors,
    mediaType: "json",
  }),
  infrastructure: defineEndpoint({
    method: "GET",
    path: "/admin/infrastructure",
    responses: {
      200: z.object({
        required: z.object({
          d1: ResourceStatusSchema,
          kv: ResourceStatusSchema,
          queue: ResourceStatusSchema,
          assets: ResourceStatusSchema,
        }),
        attachments: z.object({
          backend: z.enum(["kv", "r2"]),
          r2: ResourceStatusSchema,
          reason: z.string(),
        }),
      }),
    },
    errors: protectedErrors,
    mediaType: "json",
  }),
  r2Verify: defineEndpoint({
    method: "POST",
    path: "/admin/storage/r2/verify",
    request: { headers: IdempotencyHeadersSchema },
    responses: {
      200: z.object({
        status: z.literal("verified"),
        backend: z.literal("r2"),
      }),
    },
    errors: r2VerifyErrors,
    mediaType: "json",
  }),
  users: defineEndpoint({
    method: "GET",
    path: "/admin/users",
    responses: { 200: z.array(UserSchema) },
    errors: adminReadErrors,
    mediaType: "json",
  }),
  createUser: defineEndpoint({
    method: "POST",
    path: "/admin/users",
    request: {
      headers: IdempotencyHeadersSchema,
      body: AdminCreateSchema.options[0].omit({ resource: true }),
    },
    responses: { 201: z.object({ id: UuidSchema, email: z.string() }) },
    errors: [...adminMutationErrors, "USER_CREATE_CONFLICT"],
    mediaType: "json",
  }),
  updateUser: defineEndpoint({
    method: "PATCH",
    path: "/admin/users/:id",
    request: {
      params: z.object({ id: UuidSchema }),
      headers: IdempotencyHeadersSchema,
      body: AdminUpdateSchema.options[0].omit({ resource: true, id: true }),
    },
    responses: {
      200: z.object({
        id: UuidSchema,
        displayName: z.string().optional(),
        status: z.enum(["active", "suspended"]).optional(),
        roleIds: z.array(UuidSchema).optional(),
      }),
    },
    errors: [...adminMutationErrors, "USER_NOT_FOUND"],
    mediaType: "json",
  }),
  deleteUser: defineEndpoint({
    method: "DELETE",
    path: "/admin/users/:id",
    request: {
      params: z.object({ id: UuidSchema }),
      headers: IdempotencyHeadersSchema,
    },
    responses: { 204: null },
    errors: [...adminMutationErrors, "USER_SELF_DELETE_FORBIDDEN"],
    mediaType: "empty",
  }),
  roles: defineEndpoint({
    method: "GET",
    path: "/admin/roles",
    responses: { 200: z.array(RoleSchema) },
    errors: adminReadErrors,
    mediaType: "json",
  }),
  createRole: defineEndpoint({
    method: "POST",
    path: "/admin/roles",
    request: {
      headers: IdempotencyHeadersSchema,
      body: AdminCreateSchema.options[2].omit({ resource: true }),
    },
    responses: {
      201: z.object({
        id: UuidSchema,
        name: z.string(),
        description: z.string(),
        permissions: z.array(z.string()),
      }),
    },
    errors: [...adminMutationErrors, "ROLE_PERMISSION_INVALID"],
    mediaType: "json",
  }),
  updateRole: defineEndpoint({
    method: "PATCH",
    path: "/admin/roles/:id",
    request: {
      params: z.object({ id: UuidSchema }),
      headers: IdempotencyHeadersSchema,
      body: AdminUpdateSchema.options[2].omit({ resource: true, id: true }),
    },
    responses: {
      200: z.object({
        id: UuidSchema,
        description: z.string(),
        permissions: z.array(z.string()),
      }),
    },
    errors: [
      ...adminMutationErrors,
      "ROLE_NOT_FOUND",
      "ROLE_PERMISSION_INVALID",
      "SYSTEM_ROLE_IMMUTABLE",
    ],
    mediaType: "json",
  }),
  deleteRole: defineEndpoint({
    method: "DELETE",
    path: "/admin/roles/:id",
    request: {
      params: z.object({ id: UuidSchema }),
      headers: IdempotencyHeadersSchema,
    },
    responses: { 204: null },
    errors: [...adminMutationErrors, "SYSTEM_ROLE_IMMUTABLE"],
    mediaType: "empty",
  }),
  domains: defineEndpoint({
    method: "GET",
    path: "/admin/domains",
    responses: { 200: z.array(DomainSchema) },
    errors: adminReadErrors,
    mediaType: "json",
  }),
  createDomain: defineEndpoint({
    method: "POST",
    path: "/admin/domains",
    request: {
      headers: IdempotencyHeadersSchema,
      body: AdminCreateSchema.options[1].omit({ resource: true }),
    },
    responses: { 201: z.object({ id: UuidSchema, name: z.string() }) },
    errors: [...adminMutationErrors, "DOMAIN_CONFLICT"],
    mediaType: "json",
  }),
  updateDomain: defineEndpoint({
    method: "PATCH",
    path: "/admin/domains/:id",
    request: {
      params: z.object({ id: UuidSchema }),
      headers: IdempotencyHeadersSchema,
      body: AdminUpdateSchema.options[1].omit({ resource: true, id: true }),
    },
    responses: {
      200: z.object({
        id: UuidSchema,
        status: z.enum(["active", "disabled"]).optional(),
        outboundConnectionId: UuidSchema.nullable().optional(),
      }),
    },
    errors: adminMutationErrors,
    mediaType: "json",
  }),
  deleteDomain: defineEndpoint({
    method: "DELETE",
    path: "/admin/domains/:id",
    request: {
      params: z.object({ id: UuidSchema }),
      headers: IdempotencyHeadersSchema,
    },
    responses: { 204: null },
    errors: [...adminMutationErrors, "DOMAIN_IN_USE"],
    mediaType: "empty",
  }),
  signature: defineEndpoint({
    method: "GET",
    path: "/admin/domains/:id/signature",
    request: { params: z.object({ id: UuidSchema }) },
    responses: { 200: SignatureSchema },
    errors: [...adminReadErrors, "DOMAIN_NOT_FOUND"],
    mediaType: "json",
  }),
  saveSignature: defineEndpoint({
    method: "PUT",
    path: "/admin/domains/:id/signature",
    request: {
      params: z.object({ id: UuidSchema }),
      headers: IdempotencyHeadersSchema,
      body: z.object({
        html: z.string().max(200_000),
        text: z.string().max(200_000),
        enabled: z.boolean(),
      }),
    },
    responses: { 200: SignatureSchema },
    errors: [...adminMutationErrors, "DOMAIN_NOT_FOUND"],
    mediaType: "json",
  }),
  settings: defineEndpoint({
    method: "GET",
    path: "/admin/settings",
    responses: { 200: SettingsSchema },
    errors: adminReadErrors,
    mediaType: "json",
  }),
  saveSettings: defineEndpoint({
    method: "PATCH",
    path: "/admin/settings",
    request: { headers: IdempotencyHeadersSchema, body: settingsUpdateSchema },
    responses: { 200: SettingsSchema },
    errors: [...adminMutationErrors, "SETTINGS_INPUT_INVALID"],
    mediaType: "json",
  }),
  providerConnections: defineEndpoint({
    method: "GET",
    path: "/admin/provider-connections",
    responses: { 200: z.array(ProviderConnectionSchema) },
    errors: adminReadErrors,
    mediaType: "json",
  }),
  createProviderConnection: defineEndpoint({
    method: "POST",
    path: "/admin/provider-connections",
    request: {
      headers: IdempotencyHeadersSchema,
      body: AdminCreateSchema.options[3].omit({ resource: true }),
    },
    responses: {
      201: z.object({
        id: UuidSchema,
        providerKey: z.string(),
        label: z.string(),
        status: z.literal("active"),
      }),
    },
    errors: [...adminMutationErrors, "PROVIDER_NOT_SUPPORTED"],
    mediaType: "json",
  }),
  updateProviderConnection: defineEndpoint({
    method: "PATCH",
    path: "/admin/provider-connections/:id",
    request: {
      params: z.object({ id: UuidSchema }),
      headers: IdempotencyHeadersSchema,
      body: AdminUpdateSchema.options[3].omit({ resource: true, id: true }),
    },
    responses: {
      200: z.object({
        id: UuidSchema,
        status: z.enum(["active", "disabled", "unchanged"]),
      }),
    },
    errors: [...adminMutationErrors, "PROVIDER_CONNECTION_NOT_FOUND"],
    mediaType: "json",
  }),
  providerSync: defineEndpoint({
    method: "POST",
    path: "/admin/providers/sync",
    request: { headers: IdempotencyHeadersSchema },
    responses: {
      200: z.object({
        inserted: z.number().int(),
        updated: z.number().int(),
        skipped: z.number().int(),
        failed: z.number().int(),
      }),
    },
    errors: adminMutationErrors,
    mediaType: "json",
  }),
  webhookEvents: defineEndpoint({
    method: "GET",
    path: "/admin/webhook-events",
    request: { query: limitQuery },
    responses: { 200: z.array(WebhookEventSchema) },
    errors: adminReadErrors,
    mediaType: "json",
  }),
  deleteWebhookEvent: defineEndpoint({
    method: "DELETE",
    path: "/admin/webhook-events/:id",
    request: {
      params: z.object({ id: UuidSchema }),
      headers: IdempotencyHeadersSchema,
    },
    responses: { 204: null },
    errors: adminMutationErrors,
    mediaType: "empty",
  }),
  auditEvents: defineEndpoint({
    method: "GET",
    path: "/admin/audit-events",
    request: { query: auditQuery },
    responses: { 200: z.array(AuditEventSchema) },
    errors: adminReadErrors,
    mediaType: "json",
  }),
  analytics: defineEndpoint({
    method: "GET",
    path: "/admin/analytics",
    responses: { 200: AnalyticsSchema },
    errors: adminReadErrors,
    mediaType: "json",
  }),
} as const;
