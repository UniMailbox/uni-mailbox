import { ApiClientError } from "../lib/api/errors";

export interface ErrorToken {
  key: `errors:${string}`;
  values: Record<string, never>;
  requestId?: string;
}

export function apiErrorToken(error: unknown): ErrorToken {
  if (error instanceof ApiClientError) {
    return {
      key: `errors:api.${error.code}`,
      values: {},
      ...(error.requestId ? { requestId: error.requestId } : {}),
    };
  }

  return { key: "errors:api.UNKNOWN_SERVER_ERROR", values: {} };
}
