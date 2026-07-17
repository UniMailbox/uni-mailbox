import type { ApiFailure, ApiSuccess } from "@cf-startup/shared";

export function ok<T>(data: T, init?: ResponseInit): Response {
  return Response.json({ ok: true, data } satisfies ApiSuccess<T>, init);
}

export function fail(code: string, message: string, status = 400): Response {
  return Response.json({ ok: false, error: { code, message } } satisfies ApiFailure, {
    status
  });
}
