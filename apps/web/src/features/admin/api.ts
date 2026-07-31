import { mutationOptions, queryOptions, type QueryClient } from "@tanstack/react-query";
import {
  AdminCreateSchema,
  AdminDeleteSchema,
  AdminUpdateSchema,
  administrationEndpoints,
  type AdminResourceKey,
  type EndpointRequest,
} from "@unimailbox/contracts";
import { apiClient } from "../../lib/api/index";

type ManagedResource = Extract<AdminResourceKey, "users" | "roles" | "domains" | "provider-connections">;

export const adminKeys = {
  all: ["admin"] as const,
  resource: (resource: AdminResourceKey) => [...adminKeys.all, resource] as const,
  detail: (resource: ManagedResource, id: string) => [...adminKeys.resource(resource), id.trim()] as const,
  signature: (domainId: string) => [...adminKeys.all, "signature", domainId.trim()] as const,
  auditEvents: (search: string) => [...adminKeys.resource("audit-events"), search.trim()] as const,
};

const idempotencyHeaders = () => ({ "idempotency-key": crypto.randomUUID() });

export function auditEventsQueryOptions(search: string) {
  const normalized = search.trim();
  return queryOptions({
    queryKey: adminKeys.auditEvents(normalized),
    queryFn: () => apiClient.request(administrationEndpoints.auditEvents, { query: normalized ? { q: normalized } : {} }),
  });
}

export function adminQueryOptions(resource: AdminResourceKey) {
  if (resource === "audit-events") return auditEventsQueryOptions("");
  const endpoint = {
    users: administrationEndpoints.users,
    roles: administrationEndpoints.roles,
    domains: administrationEndpoints.domains,
    signatures: administrationEndpoints.domains,
    settings: administrationEndpoints.settings,
    "provider-connections": administrationEndpoints.providerConnections,
    "webhook-events": administrationEndpoints.webhookEvents,
    analytics: administrationEndpoints.analytics,
  }[resource];
  return queryOptions({ queryKey: adminKeys.resource(resource), queryFn: () => apiClient.request(endpoint, resource === "webhook-events" ? { query: {} } : {}) });
}

async function invalidateResource(queryClient: QueryClient, resource: AdminResourceKey): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: adminKeys.resource(resource) });
  if (resource === "domains" || resource === "provider-connections") {
    await queryClient.invalidateQueries({ queryKey: ["settings", "cloudflare", "checkpoints"] });
  }
}

export function adminMutationOptions(queryClient: QueryClient) {
  return {
    create: mutationOptions({
      mutationFn: async (input: unknown) => {
        const value = AdminCreateSchema.parse(input);
        const headers = idempotencyHeaders();
        switch (value.resource) {
          case "users": return apiClient.request(administrationEndpoints.createUser, { headers, body: { email: value.email, displayName: value.displayName, password: value.password, roleIds: value.roleIds } });
          case "roles": return apiClient.request(administrationEndpoints.createRole, { headers, body: { name: value.name, description: value.description, permissions: value.permissions } });
          case "domains": return apiClient.request(administrationEndpoints.createDomain, { headers, body: { name: value.name } });
          case "provider-connections": return apiClient.request(administrationEndpoints.createProviderConnection, { headers, body: { providerKey: value.providerKey, label: value.label, apiKey: value.apiKey, webhookSecret: value.webhookSecret, config: value.config } });
        }
      },
      onSuccess: async (_result, input) => invalidateResource(queryClient, AdminCreateSchema.parse(input).resource),
    }),
    update: mutationOptions({
      mutationFn: async (input: unknown) => {
        const value = AdminUpdateSchema.parse(input);
        const headers = idempotencyHeaders();
        switch (value.resource) {
          case "users": return apiClient.request(administrationEndpoints.updateUser, { headers, params: { id: value.id }, body: { displayName: value.displayName, status: value.status, roleIds: value.roleIds } });
          case "roles": return apiClient.request(administrationEndpoints.updateRole, { headers, params: { id: value.id }, body: { description: value.description, permissions: value.permissions } });
          case "domains": return apiClient.request(administrationEndpoints.updateDomain, { headers, params: { id: value.id }, body: { status: value.status, outboundConnectionId: value.outboundConnectionId } });
          case "provider-connections": return apiClient.request(administrationEndpoints.updateProviderConnection, { headers, params: { id: value.id }, body: { status: value.status, apiKey: value.apiKey, webhookSecret: value.webhookSecret } });
        }
      },
      onSuccess: async (_result, input) => {
        const value = AdminUpdateSchema.parse(input);
        await queryClient.invalidateQueries({ queryKey: adminKeys.detail(value.resource, value.id) });
        await invalidateResource(queryClient, value.resource);
      },
    }),
    delete: mutationOptions({
      mutationFn: async (input: unknown) => {
        const value = AdminDeleteSchema.parse(input);
        const headers = idempotencyHeaders();
        switch (value.resource) {
          case "users": return apiClient.request(administrationEndpoints.deleteUser, { headers, params: { id: value.id } });
          case "roles": return apiClient.request(administrationEndpoints.deleteRole, { headers, params: { id: value.id } });
          case "domains": return apiClient.request(administrationEndpoints.deleteDomain, { headers, params: { id: value.id } });
          case "webhook-events": return apiClient.request(administrationEndpoints.deleteWebhookEvent, { headers, params: { id: value.id } });
        }
      },
      onSuccess: async (_result, input) => invalidateResource(queryClient, AdminDeleteSchema.parse(input).resource),
    }),
  };
}

export function signatureQueryOptions(domainId: string) {
  return queryOptions({ queryKey: adminKeys.signature(domainId), enabled: Boolean(domainId.trim()), queryFn: () => apiClient.request(administrationEndpoints.signature, { params: { id: domainId.trim() } }) });
}

export function saveSignatureMutationOptions(queryClient: QueryClient, domainId: string) {
  return mutationOptions({ mutationFn: (body: EndpointRequest<typeof administrationEndpoints.saveSignature>["body"]) => apiClient.request(administrationEndpoints.saveSignature, { headers: idempotencyHeaders(), params: { id: domainId.trim() }, body }), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: adminKeys.signature(domainId) }); await invalidateResource(queryClient, "signatures"); } });
}

export function saveSettingsMutationOptions(queryClient: QueryClient) {
  return mutationOptions({ mutationFn: (body: EndpointRequest<typeof administrationEndpoints.saveSettings>["body"]) => apiClient.request(administrationEndpoints.saveSettings, { headers: idempotencyHeaders(), body }), onSuccess: async () => invalidateResource(queryClient, "settings") });
}

export function providerSyncMutationOptions(queryClient: QueryClient) {
  return mutationOptions({ mutationFn: () => apiClient.request(administrationEndpoints.providerSync, { headers: idempotencyHeaders() }), onSuccess: async () => { await invalidateResource(queryClient, "provider-connections"); await queryClient.invalidateQueries({ queryKey: adminKeys.resource("webhook-events") }); } });
}
