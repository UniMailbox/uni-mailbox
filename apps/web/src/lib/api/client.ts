import {
  type EndpointDefinition,
  type EndpointRequest,
  type EndpointResponse,
} from "@unimailbox/contracts";
import { ApiClientError } from "./errors";
import type { ApiTransport } from "./transport";

type RequestInput = Record<string, unknown>;

function parseRequest<TEndpoint extends EndpointDefinition>(
  endpoint: TEndpoint,
  input: EndpointRequest<TEndpoint>,
): RequestInput {
  const schemas = endpoint.request;
  if (!schemas) return {};
  const result: RequestInput = {};
  for (const member of ["params", "query", "headers", "body"] as const) {
    const schema = schemas[member];
    if (schema) result[member] = schema.parse((input as RequestInput)[member]);
  }
  return result;
}

function buildPath(path: string, params: Record<string, unknown> | undefined): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, (_, key: string) => {
    const value = params?.[key];
    if (value === undefined || value === null) throw new Error(`Missing path parameter: ${key}`);
    return encodeURIComponent(String(value));
  });
}

function addQuery(path: string, query: Record<string, unknown> | undefined): string {
  if (!query) return path;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) value.forEach((item) => search.append(key, String(item)));
    else search.set(key, String(value));
  }
  const serialized = search.toString();
  return serialized ? `${path}?${serialized}` : path;
}

export type ApiClient = {
  request<
    TEndpoint extends EndpointDefinition,
    TStatus extends keyof TEndpoint["responses"] & number = keyof TEndpoint["responses"] & number,
  >(
    endpoint: TEndpoint,
    input: EndpointRequest<TEndpoint>,
  ): Promise<EndpointResponse<TEndpoint, TStatus>>;
};

export function createApiClient(transport: Pick<ApiTransport, "request"> & Partial<Pick<ApiTransport, "requestWithResponse">>): ApiClient {
  return {
    async request(endpoint, input) {
      const parsed = parseRequest(endpoint, input);
      const path = addQuery(
        buildPath(endpoint.path, parsed.params as Record<string, unknown> | undefined),
        parsed.query as Record<string, unknown> | undefined,
      );
      const init: RequestInit = {
        method: endpoint.method,
        headers: parsed.headers as HeadersInit | undefined,
        ...(parsed.body === undefined || endpoint.mediaType !== "json"
          ? {}
          : { body: JSON.stringify(parsed.body) }),
      };
      const result = transport.requestWithResponse
        ? await transport.requestWithResponse(path, init)
        : { data: await transport.request(path, init), status: 200 };
      const schema = endpoint.responses[result.status];
      if (!schema) {
        if (schema === null && result.data === undefined) return undefined;
        throw new ApiClientError("CLIENT_RESPONSE_INVALID", result.status);
      }
      const parsedResponse = schema.safeParse(result.data);
      if (!parsedResponse.success) {
        throw new ApiClientError("CLIENT_RESPONSE_INVALID", result.status);
      }
      return parsedResponse.data;
    },
  };
}
