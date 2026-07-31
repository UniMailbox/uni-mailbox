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
} as const;
