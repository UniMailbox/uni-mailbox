import {
  ApiErrorEnvelopeSchema,
  type ApiErrorEnvelope,
} from "@unimailbox/contracts";
import { ApiClientError, apiErrorCode } from "./errors";

const ACCESS_TOKEN_KEY = "unimailbox.access-token";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type ApiTransport = {
  request<T = unknown>(
    path: string,
    init?: RequestInit,
    retry?: boolean,
  ): Promise<T>;
  requestWithResponse<T = unknown>(
    path: string,
    init?: RequestInit,
    retry?: boolean,
  ): Promise<{ data: T; status: number }>;
  response(path: string, init?: RequestInit, retry?: boolean): Promise<Response>;
};

export type ApiTransportOptions = {
  basePath?: string;
  fetch?: FetchLike;
  getAccessToken?: () => string | null;
  setAccessToken?: (token: string | null) => void;
};

function storageToken(): string | null {
  return window.sessionStorage.getItem(ACCESS_TOKEN_KEY);
}

function storeToken(token: string | null): void {
  if (token) window.sessionStorage.setItem(ACCESS_TOKEN_KEY, token);
  else window.sessionStorage.removeItem(ACCESS_TOKEN_KEY);
}

function readErrorEnvelope(
  response: Response,
): Promise<{ envelope?: ApiErrorEnvelope; parsedJson: boolean }> {
  return response
    .clone()
    .json()
    .then((body: unknown) => {
      const result = ApiErrorEnvelopeSchema.safeParse(body);
      return { envelope: result.success ? result.data : undefined, parsedJson: true };
    })
    .catch(() => ({ parsedJson: false }));
}

function responseError(
  status: number,
  errorBody: { envelope?: ApiErrorEnvelope; parsedJson: boolean },
  headerRequestId: string | null,
): ApiClientError {
  if (!errorBody.envelope) {
    return new ApiClientError(
      errorBody.parsedJson ? "REQUEST_FAILED" : "UNKNOWN_SERVER_ERROR",
      status,
    );
  }

  const { code, message, details, params, requestId } = errorBody.envelope.error;
  return new ApiClientError(apiErrorCode(code), status, {
    ...(apiErrorCode(code) === "UNKNOWN_SERVER_ERROR" ? { rawCode: code } : {}),
    ...(params === undefined && details === undefined ? {} : { params: params ?? details }),
    ...(details === undefined ? {} : { details }),
    ...(requestId ?? headerRequestId ? { requestId: requestId ?? headerRequestId ?? undefined } : {}),
    diagnosticMessage: message,
  });
}

function joinPath(basePath: string, path: string): string {
  const base = basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

export function createApiTransport(options: ApiTransportOptions = {}): ApiTransport {
  const fetcher: FetchLike =
    options.fetch ?? ((input, init) => window.fetch(input, init));
  const basePath = options.basePath ?? "/api/v1";
  const getAccessToken = options.getAccessToken ?? storageToken;
  const setAccessToken = options.setAccessToken ?? storeToken;

  async function fetchResponse(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    const token = getAccessToken();
    if (token) headers.set("authorization", `Bearer ${token}`);
    if (
      init.body &&
      !(typeof FormData !== "undefined" && init.body instanceof FormData) &&
      !headers.has("content-type")
    ) {
      headers.set("content-type", "application/json");
    }
    return fetcher(joinPath(basePath, path), {
      ...init,
      headers,
      credentials: "same-origin",
    });
  }

  async function refreshAccessToken(): Promise<boolean> {
    try {
      const response = await fetchResponse("/auth/refresh", { method: "POST" });
      if (!response.ok) {
        setAccessToken(null);
        return false;
      }
      const result = await decodeSuccess<{ accessToken: string }>(response);
      if (!result || typeof result.accessToken !== "string") {
        setAccessToken(null);
        return false;
      }
      setAccessToken(result.accessToken);
      return true;
    } catch {
      setAccessToken(null);
      return false;
    }
  }

  async function response(
    path: string,
    init: RequestInit = {},
    retry = true,
  ): Promise<Response> {
    const result = await fetchResponse(path, init);
    if (
      result.status === 401 &&
      retry &&
      path !== "/auth/login" &&
      path !== "/auth/refresh" &&
      (await refreshAccessToken())
    ) {
      return response(path, init, false);
    }
    if (!result.ok) {
      throw responseError(
        result.status,
        await readErrorEnvelope(result),
        result.headers.get("x-request-id"),
      );
    }
    return result;
  }

  async function decodeSuccess<T>(result: Response): Promise<T> {
    if (result.status === 204) return undefined as T;
    try {
      const body: unknown = await result.json();
      if (
        !body ||
        typeof body !== "object" ||
        !("data" in body)
      ) {
        throw new ApiClientError("CLIENT_RESPONSE_INVALID", result.status);
      }
      return (body as { data: T }).data;
    } catch (error) {
      if (error instanceof ApiClientError) throw error;
      throw new ApiClientError("CLIENT_RESPONSE_INVALID", result.status);
    }
  }

  async function requestWithResponse<T>(
    path: string,
    init?: RequestInit,
    retry?: boolean,
  ): Promise<{ data: T; status: number }> {
    const result = await response(path, init, retry);
    return { data: await decodeSuccess<T>(result), status: result.status };
  }

  async function request<T>(
    path: string,
    init?: RequestInit,
    retry?: boolean,
  ): Promise<T> {
    return (await requestWithResponse<T>(path, init, retry)).data;
  }

  return { request, requestWithResponse, response };
}

export { ApiClientError };
