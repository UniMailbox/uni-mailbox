import {
  ApiErrorEnvelopeSchema,
  type ApiErrorEnvelope,
  type MediaType,
} from "@unimailbox/contracts";
import { ApiClientError, apiErrorCode } from "./errors";

const ACCESS_TOKEN_KEY = "unimailbox.access-token";

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type ApiTransport = {
  request<T = unknown>(
    path: string,
    init?: RequestInit,
    retry?: boolean,
    mediaType?: MediaType,
  ): Promise<T>;
  requestWithResponse<T = unknown>(
    path: string,
    init?: RequestInit,
    retry?: boolean,
    mediaType?: MediaType,
  ): Promise<{ data: T; status: number; headers?: Headers }>;
  response(
    path: string,
    init?: RequestInit,
    retry?: boolean,
    mediaType?: MediaType,
  ): Promise<Response>;
};

export type ApiTransportOptions = {
  basePath?: string;
  fetch?: FetchLike;
  getAccessToken?: () => string | null;
  setAccessToken?: (token: string | null) => void;
};

export function getAccessToken(): string | null {
  return window.sessionStorage.getItem(ACCESS_TOKEN_KEY);
}

export function setAccessToken(token: string | null): void {
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
      return {
        envelope: result.success ? result.data : undefined,
        parsedJson: true,
      };
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
      headerRequestId ? { requestId: headerRequestId } : {},
    );
  }

  const { code, message, details, params, requestId } =
    errorBody.envelope.error;
  return new ApiClientError(apiErrorCode(code), status, {
    ...(apiErrorCode(code) === "UNKNOWN_SERVER_ERROR" ? { rawCode: code } : {}),
    ...(params === undefined && details === undefined
      ? {}
      : { params: params ?? details }),
    ...(details === undefined ? {} : { details }),
    ...((requestId ?? headerRequestId)
      ? { requestId: requestId ?? headerRequestId ?? undefined }
      : {}),
    diagnosticMessage: message,
  });
}

function joinPath(basePath: string, path: string): string {
  const base = basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

export function createApiTransport(
  options: ApiTransportOptions = {},
): ApiTransport {
  const fetcher: FetchLike =
    options.fetch ?? ((input, init) => window.fetch(input, init));
  const basePath = options.basePath ?? "/api/v1";
  const readAccessToken = options.getAccessToken ?? getAccessToken;
  const writeAccessToken = options.setAccessToken ?? setAccessToken;

  async function fetchResponse(
    path: string,
    init: RequestInit = {},
    mediaType: MediaType = "json",
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    const token = readAccessToken();
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
      ...(mediaType === "redirect" ? { redirect: "manual" } : {}),
    });
  }

  async function refreshAccessToken(): Promise<boolean> {
    try {
      const response = await fetchResponse("/auth/refresh", { method: "POST" });
      if (!response.ok) {
        writeAccessToken(null);
        return false;
      }
      const result = await decodeSuccess<{ accessToken: string }>(response);
      if (!result || typeof result.accessToken !== "string") {
        writeAccessToken(null);
        return false;
      }
      writeAccessToken(result.accessToken);
      return true;
    } catch {
      writeAccessToken(null);
      return false;
    }
  }

  async function response(
    path: string,
    init: RequestInit = {},
    retry = true,
    mediaType: MediaType = "json",
  ): Promise<Response> {
    const result = await fetchResponse(path, init, mediaType);
    if (
      result.status === 401 &&
      retry &&
      path !== "/auth/login" &&
      path !== "/auth/refresh" &&
      (await refreshAccessToken())
    ) {
      return response(path, init, false, mediaType);
    }
    if (
      !result.ok &&
      !(mediaType === "redirect" && result.status >= 300 && result.status < 400)
    ) {
      throw responseError(
        result.status,
        await readErrorEnvelope(result),
        result.headers.get("x-request-id"),
      );
    }
    return result;
  }

  async function decodeSuccess<T>(
    result: Response,
    mediaType: MediaType = "json",
  ): Promise<T> {
    if (result.status === 204) return undefined as T;
    if (mediaType === "empty") return undefined as T;
    if (mediaType === "binary") return (await result.arrayBuffer()) as T;
    if (mediaType === "redirect") {
      const location = result.headers.get("location") ?? result.url;
      if (location) return location as T;
      throw new ApiClientError("CLIENT_RESPONSE_INVALID", result.status);
    }
    try {
      const body: unknown = await result.json();
      if (!body || typeof body !== "object" || !("data" in body)) {
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
    mediaType: MediaType = "json",
  ): Promise<{ data: T; status: number; headers?: Headers }> {
    const result = await response(path, init, retry, mediaType);
    return {
      data: await decodeSuccess<T>(result, mediaType),
      status: result.status,
      headers: result.headers,
    };
  }

  async function request<T>(
    path: string,
    init?: RequestInit,
    retry?: boolean,
    mediaType?: MediaType,
  ): Promise<T> {
    return (await requestWithResponse<T>(path, init, retry, mediaType)).data;
  }

  return { request, requestWithResponse, response };
}

export { ApiClientError };
