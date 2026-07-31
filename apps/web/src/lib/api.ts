import { apiTransport } from "./api/index";
import { ApiClientError } from "./api/errors";

const ACCESS_TOKEN_KEY = "unimailbox.access-token";

/** @deprecated Use ApiClientError from ./api instead. */
export { ApiClientError as ApiError };

export function getAccessToken(): string | null {
  return window.sessionStorage.getItem(ACCESS_TOKEN_KEY);
}

export function setAccessToken(token: string | null): void {
  if (token) window.sessionStorage.setItem(ACCESS_TOKEN_KEY, token);
  else window.sessionStorage.removeItem(ACCESS_TOKEN_KEY);
}

/** @deprecated Use endpoint-specific apiClient.request() instead. */
export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
  retry = true,
): Promise<T> {
  return apiTransport.request<T>(path, init, retry);
}

/** @deprecated Use endpoint-specific apiClient.request() instead. */
export async function apiResponse(
  path: string,
  init: RequestInit = {},
  retry = true,
): Promise<Response> {
  return apiTransport.response(path, init, retry);
}

/** @deprecated JSON endpoint clients serialize validated request bodies. */
export function jsonBody(value: unknown): string {
  return JSON.stringify(value);
}
