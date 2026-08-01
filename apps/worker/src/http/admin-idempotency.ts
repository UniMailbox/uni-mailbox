import { DomainError } from "@unimailbox/contracts";
import type { MiddlewareHandler } from "hono";
import type { HttpAppBindings } from "./bindings";

/**
 * Middleware that turns the Idempotency-Key header into at-most-once
 * semantics for administrator mutations.
 *
 * Behavior contract (must stay in sync with the integration test):
 * - Applies only to mutating verbs (POST/PUT/PATCH/DELETE). Read requests
 *   and OPTIONS preflights are forwarded unchanged.
 * - Requires an Idempotency-Key header of 1..255 characters; otherwise the
 *   middleware short-circuits with `IDEMPOTENCY_KEY_REQUIRED` (428).
 * - Builds a request fingerprint from `method + path + raw body` so that a
 *   different payload under the same key is rejected with
 *   `IDEMPOTENCY_KEY_REUSED` (409).
 * - Only caches 2xx responses under `idempotency_records` for 24 hours;
 *   non-2xx responses are allowed to retry without polluting the table.
 * - Replays return the original status, body and content-type together with
 *   `x-idempotent-replay: 1` so callers can short-circuit safely.
 */
export function requireAdminIdempotency(): MiddlewareHandler<HttpAppBindings> {
  return async (context, next) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(context.req.method)) {
      await next();
      return;
    }
    const idempotencyKey = context.req.header("idempotency-key");
    if (!idempotencyKey || idempotencyKey.length > 255) {
      throw new DomainError(
        "IDEMPOTENCY_KEY_REQUIRED",
        "Administrator mutations require an Idempotency-Key",
        428,
      );
    }
    const principal = context.get("principal");
    const operation = `admin.${context.req.method.toLowerCase()}.${context.req.path}`;
    const rawBody = await context.req.raw.clone().text();
    const hash = await requestHash(
      JSON.stringify({
        method: context.req.method,
        path: context.req.path,
        body: rawBody,
      }),
    );
    const existing = await context.env.DB.prepare(
      `SELECT request_hash, response_json
       FROM idempotency_records
       WHERE actor_user_id = ? AND operation = ? AND idempotency_key = ?
         AND expires_at > CURRENT_TIMESTAMP`,
    )
      .bind(principal.userId, operation, idempotencyKey)
      .first<{ request_hash: string; response_json: string }>();
    if (existing) {
      if (existing.request_hash !== hash) {
        throw new DomainError(
          "IDEMPOTENCY_KEY_REUSED",
          "The idempotency key was used with different input",
          409,
        );
      }
      const replay = JSON.parse(existing.response_json) as {
        body: string;
        status: number;
        contentType: string | null;
      };
      return new Response(replay.body || null, {
        status: replay.status,
        headers: replay.contentType
          ? { "content-type": replay.contentType, "x-idempotent-replay": "1" }
          : { "x-idempotent-replay": "1" },
      });
    }

    await next();
    // Only persist successful responses; non-2xx results must be allowed to
    // retry without poisoning the cache and avoid holding transient errors.
    if (context.res.status < 200 || context.res.status >= 300) return;
    const response = context.res.clone();
    const body = await response.text();
    await context.env.DB.prepare(
      `INSERT INTO idempotency_records (
         id, actor_user_id, operation, idempotency_key, request_hash,
         response_status, response_json, expires_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', '+1 day'))`,
    )
      .bind(
        crypto.randomUUID(),
        principal.userId,
        operation,
        idempotencyKey,
        hash,
        response.status,
        JSON.stringify({
          body,
          status: response.status,
          contentType: response.headers.get("content-type"),
        }),
      )
      .run();
  };
}

// Stable SHA-256 hex fingerprint of the request payload. Local to this
// module because the admin middleware is the only consumer; other HMAC/hash
// helpers in the worker intentionally stay near their signing boundary to
// make token-format changes a local edit.
export async function requestHash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
