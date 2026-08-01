import { createApiClient } from "./client";
import { createApiTransport } from "./transport";

export * from "./client";
export * from "./errors";
export * from "./transport";

/**
 * Shared browser API boundary.
 *
 * Feature modules own React Query keys and cache effects; this client owns
 * contract validation and delegates authentication, refresh, and wire-level
 * error normalization to the transport.
 */
export const apiTransport = createApiTransport({ basePath: "/api/v1" });
export const apiClient = createApiClient(apiTransport);
