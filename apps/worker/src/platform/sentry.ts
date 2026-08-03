import * as Sentry from "@sentry/cloudflare";
import type { CloudflareOptions, Event } from "@sentry/cloudflare";
import { DomainError } from "@unimailbox/contracts";
import type { Env } from "./config";

type SampleRate = number | string | undefined;

const SENSITIVE_KEYS = new Set([
  "accesstoken",
  "apikey",
  "authorization",
  "bcc",
  "body",
  "cc",
  "content",
  "cookie",
  "credentials",
  "currentpassword",
  "email",
  "filename",
  "from",
  "fromaddress",
  "html",
  "idempotencykey",
  "mailboxaddress",
  "mailboxid",
  "messagebody",
  "messageid",
  "newpassword",
  "password",
  "raw",
  "refreshtoken",
  "secret",
  "set-cookie",
  "subject",
  "text",
  "to",
  "toaddress",
  "token",
  "userid",
  "webhooksecret",
  "x-api-key",
  "x-setup-csrf",
]);

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu;
const BEARER_PATTERN = /\bBearer\s+[^\s,;]+/giu;
const UUID_PATTERN =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu;

function normalizedKey(key: string): string {
  return key.replace(/[-_.\s]/gu, "").toLowerCase();
}

function redactString(value: string): string {
  return value
    .replace(EMAIL_PATTERN, "[REDACTED_EMAIL]")
    .replace(BEARER_PATTERN, "Bearer [REDACTED]");
}

function sanitizeValue(value: unknown, key = "", depth = 0): unknown {
  if (SENSITIVE_KEYS.has(normalizedKey(key))) return "[REDACTED]";
  if (typeof value === "string") return redactString(value);
  if (depth >= 8 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value))
    return value.map((item) => sanitizeValue(item, "", depth + 1));
  const source = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(source).map(([childKey, child]) => [
      childKey,
      sanitizeValue(child, childKey, depth + 1),
    ]),
  );
}

function stripUrlDetails(value: string): string {
  try {
    const url = new URL(value, "https://worker.invalid");
    url.search = "";
    url.hash = "";
    return value.startsWith("http") ? url.toString() : url.pathname;
  } catch {
    return value.split(/[?#]/u, 1)[0] ?? value;
  }
}

export function scrubWorkerSentryEvent<T extends Event>(event: T): T {
  const scrubbed = sanitizeValue(event) as T;
  if (scrubbed.request) {
    if (scrubbed.request.url)
      scrubbed.request.url = stripUrlDetails(scrubbed.request.url);
    delete scrubbed.request.cookies;
    delete scrubbed.request.data;
    delete scrubbed.request.query_string;
  }
  if (scrubbed.user) {
    scrubbed.user = scrubbed.user.id ? { id: scrubbed.user.id } : undefined;
  }
  return scrubbed;
}

export function parseWorkerSentrySampleRate(
  value: SampleRate,
  fallback: number,
): number {
  if (value === undefined || value === "") return fallback;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(1, Math.max(0, parsed));
}

export function createWorkerSentryOptions(env: Env): CloudflareOptions {
  const dsn = env.SENTRY_DSN?.trim();
  return {
    dsn: dsn || undefined,
    enabled: Boolean(dsn),
    environment: env.SENTRY_ENVIRONMENT?.trim() || "production",
    release:
      env.SENTRY_RELEASE?.trim() || env.CF_VERSION_METADATA?.tag || undefined,
    sampleRate: parseWorkerSentrySampleRate(env.SENTRY_SAMPLE_RATE, 1),
    tracesSampleRate: parseWorkerSentrySampleRate(
      env.SENTRY_TRACES_SAMPLE_RATE,
      0,
    ),
    sendDefaultPii: false,
    beforeSend: (event) => scrubWorkerSentryEvent(event),
    beforeSendTransaction: (event) => scrubWorkerSentryEvent(event),
  };
}

export function shouldCaptureWorkerError(error: unknown): boolean {
  return !(error instanceof DomainError) || error.status >= 500;
}

export function captureWorkerHttpError(
  error: unknown,
  context: { method: string; path: string; requestId: string },
): void {
  if (!shouldCaptureWorkerError(error)) return;
  Sentry.withScope((scope) => {
    scope.setTag("error.source", "hono");
    scope.setTag("http.method", context.method);
    scope.setTag(
      "http.route",
      stripUrlDetails(context.path).replace(UUID_PATTERN, ":id"),
    );
    scope.setTag("request.id", context.requestId);
    if (error instanceof DomainError)
      scope.setTag("domain_error.code", error.code);
    Sentry.captureException(error);
  });
}

export function captureWorkerQueueError(
  error: unknown,
  context: { attempts?: number; kind: string },
): void {
  Sentry.withScope((scope) => {
    scope.setTag("error.source", "queue");
    scope.setTag("queue.job.kind", context.kind);
    if (context.attempts !== undefined)
      scope.setTag("queue.attempts", String(context.attempts));
    Sentry.captureException(error);
  });
}
