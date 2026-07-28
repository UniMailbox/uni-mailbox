import { z } from "zod";

export const RuntimeConfigSchema = z.object({
  AUTH_SIGNING_KEY: z.string().min(32),
  CREDENTIAL_ENCRYPTION_KEY: z.string().min(32),
  ALLOWED_ORIGINS: z.array(z.string().url()).default([]),
});

export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>;

export const runtimePolicy = {
  accessTokenTtlSeconds: 15 * 60,
  refreshTokenTtlSeconds: 30 * 24 * 60 * 60,
  oauthStateTtlSeconds: 10 * 60,
  passwordIterations: 310_000,
  outboundAttemptLimit: 5,
  webhookLockTtlMs: 2 * 60 * 1000,
  outboundLockTtlMs: 5 * 60 * 1000,
  providerSyncPageLimit: 100,
  webhookRequestsPerMinute: 1_000,
} as const;
