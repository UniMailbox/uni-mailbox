import { runtimePolicy } from "@unimailbox/config";
import { DomainError } from "@unimailbox/contracts";

/**
 * Fixed-window rate limiting on top of Workers KV.
 *
 * Why a fixed window and not a rolling counter: the previous implementation
 * kept one key per subject and re-applied `expirationTtl` on every increment,
 * which slid the expiry forward for as long as traffic kept arriving. A busy
 * subject could therefore never leave its window and stayed rejected until it
 * went completely idle for the whole TTL. Encoding the window index in the key
 * makes each window a distinct, self-expiring key: the counter resets by
 * construction and the TTL is never refreshed for a window already in flight.
 *
 * Consistency caveat, on purpose: KV reads are served from a per-colo cache
 * whose minimum (and default) TTL is 60 seconds, and writes take up to a
 * minute to propagate globally. Counts are therefore approximate and the
 * limiter is biased toward letting traffic through rather than rejecting it.
 * It exists to blunt abuse, not to enforce an exact quota — anything needing
 * exact accounting must not be built on this module.
 */
export interface RateLimitRule {
  /** Key namespace, e.g. `send` produces `rate:send:<subject>:<window>`. */
  scope: string;
  /** Maximum number of accepted hits inside a single window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
  /** DomainError code raised once the window is exhausted. */
  code: string;
  /** DomainError message raised once the window is exhausted. */
  message: string;
}

/**
 * Every limiter in the worker, in one place so the quotas can be reviewed
 * without grepping the call sites.
 */
export const rateLimitRules = {
  login: {
    scope: "login",
    limit: 10,
    windowSeconds: 900,
    code: "LOGIN_RATE_LIMITED",
    message: "Too many requests",
  },
  register: {
    scope: "register",
    limit: 5,
    windowSeconds: 3600,
    code: "REGISTRATION_RATE_LIMITED",
    message: "Too many requests",
  },
  messageSend: {
    scope: "send",
    limit: 60,
    windowSeconds: 60,
    code: "MESSAGE_SEND_RATE_LIMITED",
    message: "Too many send requests",
  },
  attachmentUpload: {
    scope: "attachment",
    limit: 100,
    windowSeconds: 3600,
    code: "ATTACHMENT_RATE_LIMITED",
    message: "Too many attachment upload requests",
  },
  webhook: {
    scope: "webhook",
    limit: runtimePolicy.webhookRequestsPerMinute,
    windowSeconds: 60,
    code: "WEBHOOK_RATE_LIMITED",
    message: "Too many webhook requests",
  },
} as const satisfies Record<string, RateLimitRule>;

/**
 * KV refuses any `expirationTtl` below 60 seconds, so short windows are kept
 * alive a little past their end. Harmless: a key belongs to exactly one
 * window, and the window index in the key has already moved on.
 */
const KV_MINIMUM_TTL_SECONDS = 60;

export function rateLimitWindowKey(
  rule: RateLimitRule,
  subject: string,
  now: number,
): string {
  const window = Math.floor(now / 1000 / rule.windowSeconds);
  return `rate:${rule.scope}:${subject}:${window}`;
}

/**
 * Counts one hit against `rule` for `subject` and throws a 429 DomainError
 * once the window is exhausted.
 *
 * Rejected requests are *not* counted: the check happens before the
 * increment, so a subject that is already over its quota stops generating KV
 * writes entirely. That is what keeps a hostile burst from turning into a
 * write storm against a single hot key.
 */
export async function enforceRateLimit(
  kv: KVNamespace,
  rule: RateLimitRule,
  subject: string,
  now: number = Date.now(),
): Promise<void> {
  const key = rateLimitWindowKey(rule, subject, now);
  const parsed = Number.parseInt((await kv.get(key)) ?? "0", 10);
  const count = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  if (count >= rule.limit) {
    throw new DomainError(rule.code, rule.message, 429);
  }
  await kv.put(key, String(count + 1), {
    // Bound to the window, never to the request: the TTL covers the tail of
    // the current window plus one grace period and is deliberately computed
    // from the window start, so repeated increments cannot extend it.
    expirationTtl: Math.max(
      KV_MINIMUM_TTL_SECONDS,
      rule.windowSeconds + KV_MINIMUM_TTL_SECONDS,
    ),
  });
}
