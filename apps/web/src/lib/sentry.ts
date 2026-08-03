import * as Sentry from "@sentry/react";
import type { Event } from "@sentry/react";
import { ForbiddenRouteError } from "./forbidden-route-error";
import { ApiClientError } from "./api/errors";

type SampleRate = number | string | undefined;

export interface BrowserSentryConfig {
  dsn?: string;
  environment?: string;
  release?: string;
  sampleRate?: SampleRate;
  tracesSampleRate?: SampleRate;
}

const SENSITIVE_KEYS = new Set([
  "accesstoken",
  "apikey",
  "authorization",
  "bcc",
  "body",
  "cc",
  "content",
  "cookie",
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
  "webhooksecret",
  "x-api-key",
  "x-setup-csrf",
]);

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu;
const BEARER_PATTERN = /\bBearer\s+[^\s,;]+/giu;
let browserSentryEnabled = false;

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
    const url = new URL(value, window.location.origin);
    url.search = "";
    url.hash = "";
    return value.startsWith("http") ? url.toString() : url.pathname;
  } catch {
    return value.split(/[?#]/u, 1)[0] ?? value;
  }
}

export function scrubBrowserSentryEvent<T extends Event>(event: T): T {
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

export function parseSentrySampleRate(
  value: SampleRate,
  fallback: number,
): number {
  if (value === undefined || value === "") return fallback;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(1, Math.max(0, parsed));
}

export function initBrowserSentry(config: BrowserSentryConfig): boolean {
  const dsn = config.dsn?.trim();
  browserSentryEnabled = Boolean(dsn);
  if (!dsn) return false;
  Sentry.init({
    dsn,
    environment: config.environment?.trim() || undefined,
    release: config.release?.trim() || undefined,
    sampleRate: parseSentrySampleRate(config.sampleRate, 1),
    tracesSampleRate: parseSentrySampleRate(config.tracesSampleRate, 0),
    sendDefaultPii: false,
    beforeSend: (event) => scrubBrowserSentryEvent(event),
    beforeSendTransaction: (event) => scrubBrowserSentryEvent(event),
  });
  return true;
}

export function captureRouteError(
  error: unknown,
  context: { routeId?: string } = {},
): void {
  captureBrowserError(error, "tanstack-router", context);
}

export function shouldCaptureBrowserError(error: unknown): boolean {
  if (error instanceof ForbiddenRouteError) return false;
  if (error instanceof ApiClientError) {
    return (
      error.status >= 500 ||
      error.code === "CLIENT_RESPONSE_INVALID" ||
      error.code === "UNKNOWN_SERVER_ERROR"
    );
  }
  return true;
}

export function captureBrowserError(
  error: unknown,
  source: "query" | "mutation" | "tanstack-router",
  context: { routeId?: string } = {},
): void {
  if (!browserSentryEnabled || !shouldCaptureBrowserError(error)) return;
  Sentry.withScope((scope) => {
    scope.setTag("error.source", source);
    if (context.routeId) scope.setTag("route.id", context.routeId);
    if (error instanceof ApiClientError) {
      scope.setTag("api.error.code", error.code);
      scope.setTag("http.status_code", String(error.status));
    }
    Sentry.captureException(error);
  });
}

export function resetBrowserSentryForTests(): void {
  browserSentryEnabled = false;
}
