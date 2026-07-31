import type { z } from "zod";
import type { ErrorCode } from "./errors";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type MediaType = "json" | "empty" | "binary" | "redirect";

export type EndpointDefinition = {
  method: HttpMethod;
  path: string;
  request?: {
    params?: z.ZodTypeAny;
    query?: z.ZodTypeAny;
    headers?: z.ZodTypeAny;
    body?: z.ZodTypeAny;
  };
  responses: Record<number, z.ZodTypeAny | null>;
  errors: readonly ErrorCode[];
  mediaType: MediaType;
  /** A binary endpoint may expose only safe, contract-defined response metadata. */
  binaryResponse?: "blob-with-content-disposition";
};

export function defineEndpoint<const TDefinition extends EndpointDefinition>(
  definition: TDefinition,
): TDefinition {
  return definition;
}

type RequestMember<
  TEndpoint extends EndpointDefinition,
  TMember extends "params" | "query" | "headers" | "body",
> =
  TEndpoint["request"] extends Record<TMember, infer TSchema>
    ? TSchema extends z.ZodTypeAny
      ? { [TKey in TMember]: z.input<TSchema> }
      : {}
    : {};

export type EndpointRequest<TEndpoint extends EndpointDefinition> =
  RequestMember<TEndpoint, "params"> &
    RequestMember<TEndpoint, "query"> &
    RequestMember<TEndpoint, "headers"> &
    RequestMember<TEndpoint, "body">;

export type EndpointResponse<
  TEndpoint extends EndpointDefinition,
  TStatus extends keyof TEndpoint["responses"] &
    number = keyof TEndpoint["responses"] & number,
> = TEndpoint["responses"][TStatus] extends z.ZodTypeAny
  ? z.output<TEndpoint["responses"][TStatus]>
  : undefined;
