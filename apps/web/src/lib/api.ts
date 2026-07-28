import type { ApiErrorBody } from "@unimailbox/contracts";

const ACCESS_TOKEN_KEY = "unimailbox.access-token";

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function getAccessToken(): string | null {
  return window.sessionStorage.getItem(ACCESS_TOKEN_KEY);
}

export function setAccessToken(token: string | null): void {
  if (token) {
    window.sessionStorage.setItem(ACCESS_TOKEN_KEY, token);
  } else {
    window.sessionStorage.removeItem(ACCESS_TOKEN_KEY);
  }
}

async function parse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const body = (await response.json()) as { data: T } | ApiErrorBody;
  if (!response.ok || "error" in body) {
    const error =
      "error" in body
        ? body.error
        : {
            code: "REQUEST_FAILED",
            message: `Request failed with status ${response.status}`,
          };
    throw new ApiError(
      error.code,
      error.message,
      response.status,
      "details" in error ? error.details : undefined,
    );
  }
  return body.data;
}

async function refreshAccessToken(): Promise<boolean> {
  const response = await fetch("/api/v1/auth/refresh", {
    method: "POST",
    credentials: "same-origin",
  });
  if (!response.ok) {
    setAccessToken(null);
    return false;
  }
  const result = await parse<{ accessToken: string }>(response);
  setAccessToken(result.accessToken);
  return true;
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
  retry = true,
): Promise<T> {
  return parse<T>(await apiResponse(path, init, retry));
}

export async function apiResponse(
  path: string,
  init: RequestInit = {},
  retry = true,
): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = getAccessToken();
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData)) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    headers,
    credentials: "same-origin",
  });
  if (
    response.status === 401 &&
    retry &&
    path !== "/auth/login" &&
    (await refreshAccessToken())
  ) {
    return apiResponse(path, init, false);
  }
  if (!response.ok) {
    await parse<never>(response);
  }
  return response;
}

export function jsonBody(value: unknown): string {
  return JSON.stringify(value);
}
