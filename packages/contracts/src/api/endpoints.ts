import type { EndpointDefinition } from "./common/endpoint";
import { authEndpoints } from "./auth";

/** Endpoint groups are accumulated here as feature contracts are migrated. */
export const endpoints = { auth: authEndpoints } as const satisfies Record<
  string,
  Record<string, EndpointDefinition>
>;
