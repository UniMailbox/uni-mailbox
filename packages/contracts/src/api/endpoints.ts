import type { EndpointDefinition } from "./common/endpoint";

/** Endpoint groups are accumulated here as feature contracts are migrated. */
export const endpoints = {} as const satisfies Record<string, EndpointDefinition>;
