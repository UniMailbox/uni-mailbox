import { createApiClient } from "./client";
import { createApiTransport } from "./transport";

export * from "./client";
export * from "./errors";
export * from "./transport";

export const apiTransport = createApiTransport({ basePath: "/api/v1" });
export const apiClient = createApiClient(apiTransport);
