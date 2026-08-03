import {
  infiniteQueryOptions,
  mutationOptions,
  queryOptions,
  type QueryClient,
} from "@tanstack/react-query";
import { z } from "zod";
import {
  AdminCreateSchema,
  AdminDeleteSchema,
  AdminUpdateSchema,
  administrationEndpoints,
  type AdminResourceKey,
  type PermissionKey,
  type EndpointRequest,
  type EndpointResponse,
} from "@unimailbox/contracts";
import { apiClient } from "../../lib/api/index";

type ManagedResource = Extract<
  AdminResourceKey,
  "users" | "roles" | "domains" | "provider-connections"
>;
type WritableResource =
  | ManagedResource
  | "signatures"
  | "settings"
  | "webhook-events"
  | "provider-sync";
type AdminCreateInput = z.input<typeof AdminCreateSchema>;
type AdminUpdateInput = z.input<typeof AdminUpdateSchema>;
type AdminDeleteInput = z.input<typeof AdminDeleteSchema>;

function splitCommaValues(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function commaSeparated<TSchema extends z.ZodTypeAny>(schema: TSchema) {
  return z.string().transform(splitCommaValues).pipe(schema);
}

const userCreateBody = AdminCreateSchema.options[0].omit({ resource: true });
const roleCreateBody = AdminCreateSchema.options[2].omit({ resource: true });
const domainCreateBody = AdminCreateSchema.options[1].omit({ resource: true });
const providerCreateBody = AdminCreateSchema.options[3].omit({
  resource: true,
});
const userUpdate = AdminUpdateSchema.options[0];
const roleUpdate = AdminUpdateSchema.options[2];
const domainUpdate = AdminUpdateSchema.options[1];
const providerUpdate = AdminUpdateSchema.options[3];

/** Form schemas accept UI state and produce endpoint-ready bodies. */
export const adminFormSchemas = {
  createUser: userCreateBody,
  createRole: roleCreateBody.extend({
    permissions: commaSeparated(roleCreateBody.shape.permissions),
  }),
  createDomain: domainCreateBody,
  createProviderConnection: providerCreateBody,
  manageUser: z.discriminatedUnion("action", [
    z.object({
      action: z.literal("delete"),
      id: userUpdate.shape.id,
      displayName: z.string(),
      status: z.string(),
      roleIds: z.string(),
    }),
    z.object({
      action: z.literal("update"),
      id: userUpdate.shape.id,
      displayName: z.union([
        z.literal(""),
        userUpdate.shape.displayName.unwrap(),
      ]),
      status: z.union([z.literal(""), userUpdate.shape.status.unwrap()]),
      roleIds: z.array(z.string().trim().uuid()).max(20),
    }),
  ]),
  manageRole: z.discriminatedUnion("action", [
    z.object({
      action: z.literal("delete"),
      id: roleUpdate.shape.id,
      description: z.string(),
      permissions: z.string(),
    }),
    z.object({
      action: z.literal("update"),
      id: roleUpdate.shape.id,
      description: roleUpdate.shape.description,
      permissions: commaSeparated(roleUpdate.shape.permissions),
    }),
  ]),
  manageDomain: z.discriminatedUnion("action", [
    z.object({
      action: z.literal("delete"),
      id: domainUpdate.shape.id,
      status: z.string(),
      outboundConnectionId: z.string(),
    }),
    z.object({
      action: z.literal("update"),
      id: domainUpdate.shape.id,
      status: z.union([z.literal(""), domainUpdate.shape.status.unwrap()]),
      outboundConnectionId: z.union([
        z.literal(""),
        domainUpdate.shape.outboundConnectionId.unwrap().unwrap(),
      ]),
    }),
  ]),
  manageProviderConnection: z.object({
    id: providerUpdate.shape.id,
    status: z.union([z.literal(""), providerUpdate.shape.status.unwrap()]),
    apiKey: z.union([z.literal(""), providerUpdate.shape.apiKey.unwrap()]),
    webhookSecret: z.union([
      z.literal(""),
      providerUpdate.shape.webhookSecret.unwrap(),
    ]),
  }),
  deleteWebhookEvent: AdminDeleteSchema.options[3].omit({ resource: true }),
  signature: administrationEndpoints.saveSignature.request.body,
  settings: administrationEndpoints.settings.responses[200].pick({
    site_title: true,
    registration_enabled: true,
    invite_required: true,
    inbound_enabled: true,
    outbound_enabled: true,
    unknown_recipient_policy: true,
    max_mailboxes_per_user: true,
    max_attachments_per_message: true,
    max_attachment_bytes: true,
  }),
};

const WRITE_PERMISSION: Record<WritableResource, PermissionKey> = {
  users: "user.manage",
  roles: "role.manage",
  domains: "domain.manage",
  "provider-connections": "domain.manage",
  signatures: "signature.manage",
  settings: "settings.manage",
  "webhook-events": "webhook_event.delete",
  "provider-sync": "provider.sync",
};

export function canAdminWrite(
  resource: WritableResource,
  permissions: readonly PermissionKey[],
): boolean {
  return permissions.includes(WRITE_PERMISSION[resource]);
}

export const adminKeys = {
  all: ["admin"] as const,
  resource: (resource: AdminResourceKey) =>
    [...adminKeys.all, resource] as const,
  detail: (resource: ManagedResource | "webhook-events", id: string) =>
    [...adminKeys.resource(resource), id.trim()] as const,
  signature: (domainId: string) =>
    [...adminKeys.all, "signature", domainId.trim()] as const,
  providerCatalog: () => [...adminKeys.all, "provider-catalog"] as const,
  auditEvents: (search: string) =>
    [...adminKeys.resource("audit-events"), search.trim()] as const,
  messages: () => [...adminKeys.resource("messages"), "pages"] as const,
  attachments: (search: string) =>
    [...adminKeys.resource("attachments"), "pages", search.trim()] as const,
  message: (messageId: string) =>
    [...adminKeys.resource("messages"), messageId.trim()] as const,
  attachmentDownload: (attachmentId: string) =>
    [
      ...adminKeys.resource("attachments"),
      "download",
      attachmentId.trim(),
    ] as const,
  userMailboxes: (userId: string) =>
    [...adminKeys.resource("users"), "mailboxes", userId.trim()] as const,
};

export function adminMessagesInfiniteQueryOptions() {
  return infiniteQueryOptions({
    queryKey: adminKeys.messages(),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      apiClient.request(administrationEndpoints.messages, {
        query: {
          limit: 50,
          ...(pageParam ? { cursor: pageParam } : {}),
        },
      }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

export function adminMessageQueryOptions(messageId: string | null) {
  return queryOptions({
    queryKey: adminKeys.message(messageId ?? ""),
    queryFn: () =>
      apiClient.request(administrationEndpoints.message, {
        params: { id: messageId! },
      }),
    enabled: Boolean(messageId),
  });
}

export function adminAttachmentsInfiniteQueryOptions(search: string) {
  const normalized = search.trim();
  return infiniteQueryOptions({
    queryKey: adminKeys.attachments(normalized),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      apiClient.request(administrationEndpoints.attachments, {
        query: {
          limit: 50,
          ...(normalized ? { q: normalized } : {}),
          ...(pageParam ? { cursor: pageParam } : {}),
        },
      }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

export function adminAttachmentDownloadQueryOptions(attachmentId: string) {
  return queryOptions({
    queryKey: adminKeys.attachmentDownload(attachmentId),
    queryFn: () =>
      apiClient.request(administrationEndpoints.attachmentDownload, {
        params: { id: attachmentId },
      }),
    enabled: Boolean(attachmentId),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    retry: false,
  });
}

const idempotencyHeaders = () => ({ "idempotency-key": crypto.randomUUID() });

export function auditEventsQueryOptions(search: string) {
  const normalized = search.trim();
  return queryOptions({
    queryKey: adminKeys.auditEvents(normalized),
    queryFn: () =>
      apiClient.request(administrationEndpoints.auditEvents, {
        query: normalized ? { q: normalized } : {},
      }),
  });
}

export type AdminQueryData =
  | EndpointResponse<typeof administrationEndpoints.users>
  | EndpointResponse<typeof administrationEndpoints.roles>
  | EndpointResponse<typeof administrationEndpoints.domains>
  | EndpointResponse<typeof administrationEndpoints.settings>
  | EndpointResponse<typeof administrationEndpoints.providerConnections>
  | EndpointResponse<typeof administrationEndpoints.webhookEvents>
  | EndpointResponse<typeof administrationEndpoints.auditEvents>
  | EndpointResponse<typeof administrationEndpoints.analytics>
  | EndpointResponse<typeof administrationEndpoints.attachments>
  | EndpointResponse<typeof administrationEndpoints.messages>;

export function adminQueryOptions(
  resource: AdminResourceKey,
  auditSearch = "",
) {
  const normalizedSearch = auditSearch.trim();
  const queryKey =
    resource === "audit-events"
      ? adminKeys.auditEvents(normalizedSearch)
      : adminKeys.resource(resource);
  const queryFn = async (): Promise<AdminQueryData> => {
    switch (resource) {
      case "messages":
        return apiClient.request(administrationEndpoints.messages, {
          query: { limit: 50 },
        });
      case "attachments":
        return apiClient.request(administrationEndpoints.attachments, {
          query: { limit: 50 },
        });
      case "users":
        return apiClient.request(administrationEndpoints.users, {});
      case "roles":
        return apiClient.request(administrationEndpoints.roles, {});
      case "domains":
      case "signatures":
        return apiClient.request(administrationEndpoints.domains, {});
      case "settings":
        return apiClient.request(administrationEndpoints.settings, {});
      case "provider-connections":
        return apiClient.request(
          administrationEndpoints.providerConnections,
          {},
        );
      case "webhook-events":
        return apiClient.request(administrationEndpoints.webhookEvents, {
          query: {},
        });
      case "audit-events":
        return apiClient.request(administrationEndpoints.auditEvents, {
          query: normalizedSearch ? { q: normalizedSearch } : {},
        });
      case "analytics":
        return apiClient.request(administrationEndpoints.analytics, {});
    }
  };
  return queryOptions<AdminQueryData>({ queryKey, queryFn });
}

export function adminUserRoleOptionsQueryOptions() {
  return queryOptions({
    queryKey: [...adminKeys.resource("users"), "role-options"] as const,
    queryFn: () =>
      apiClient.request(administrationEndpoints.userRoleOptions, {}),
  });
}

export function userMailboxesQueryOptions(userId: string) {
  return queryOptions({
    queryKey: adminKeys.userMailboxes(userId),
    queryFn: () =>
      apiClient.request(administrationEndpoints.userMailboxes, {
        params: { id: userId },
      }),
    enabled: Boolean(userId),
  });
}

export function addUserMailboxAccessMutationOptions(
  queryClient: QueryClient,
  userId: string,
) {
  return mutationOptions({
    mutationFn: (
      body: EndpointRequest<
        typeof administrationEndpoints.addUserMailbox
      >["body"],
    ) =>
      apiClient.request(administrationEndpoints.addUserMailbox, {
        headers: idempotencyHeaders(),
        params: { id: userId },
        body,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: adminKeys.userMailboxes(userId),
      });
    },
  });
}

export function updateUserMailboxAccessMutationOptions(
  queryClient: QueryClient,
  userId: string,
) {
  return mutationOptions({
    mutationFn: ({
      mailboxId,
      body,
    }: {
      mailboxId: string;
      body: EndpointRequest<
        typeof administrationEndpoints.updateUserMailbox
      >["body"];
    }) =>
      apiClient.request(administrationEndpoints.updateUserMailbox, {
        headers: idempotencyHeaders(),
        params: { id: userId, mailboxId },
        body,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: adminKeys.userMailboxes(userId),
      });
    },
  });
}

export function removeUserMailboxAccessMutationOptions(
  queryClient: QueryClient,
  userId: string,
) {
  return mutationOptions({
    mutationFn: (mailboxId: string) =>
      apiClient.request(administrationEndpoints.removeUserMailbox, {
        headers: idempotencyHeaders(),
        params: { id: userId, mailboxId },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: adminKeys.userMailboxes(userId),
      });
    },
  });
}

export function providerConnectionsQueryOptions() {
  return queryOptions({
    queryKey: adminKeys.resource("provider-connections"),
    queryFn: () =>
      apiClient.request(administrationEndpoints.providerConnections, {}),
  });
}

export function providerCatalogQueryOptions() {
  return queryOptions({
    queryKey: adminKeys.providerCatalog(),
    queryFn: () =>
      apiClient.request(administrationEndpoints.providerCatalog, {}),
  });
}

export function testDomainProviderMutationOptions(domainId: string) {
  return mutationOptions({
    mutationFn: (to: string) =>
      apiClient.request(administrationEndpoints.testDomainProvider, {
        headers: idempotencyHeaders(),
        params: { id: domainId },
        body: { to },
      }),
  });
}

async function invalidateResource(
  queryClient: QueryClient,
  resource: AdminResourceKey,
): Promise<void> {
  await queryClient.invalidateQueries({
    queryKey: adminKeys.resource(resource),
  });
  if (resource === "domains" || resource === "provider-connections") {
    await queryClient.invalidateQueries({
      queryKey: ["settings", "cloudflare", "checkpoints"],
    });
  }
}

export function adminMutationOptions(queryClient: QueryClient) {
  return {
    create: mutationOptions({
      mutationFn: async (input: AdminCreateInput) => {
        const value = AdminCreateSchema.parse(input);
        const headers = idempotencyHeaders();
        switch (value.resource) {
          case "users":
            return apiClient.request(administrationEndpoints.createUser, {
              headers,
              body: {
                email: value.email,
                displayName: value.displayName,
                password: value.password,
                roleIds: value.roleIds,
              },
            });
          case "roles":
            return apiClient.request(administrationEndpoints.createRole, {
              headers,
              body: {
                name: value.name,
                description: value.description,
                permissions: value.permissions,
              },
            });
          case "domains":
            return apiClient.request(administrationEndpoints.createDomain, {
              headers,
              body: { name: value.name },
            });
          case "provider-connections":
            return apiClient.request(
              administrationEndpoints.createProviderConnection,
              {
                headers,
                body: {
                  providerKey: value.providerKey,
                  label: value.label,
                  apiKey: value.apiKey,
                  webhookSecret: value.webhookSecret,
                  config: value.config,
                },
              },
            );
        }
      },
      onSuccess: async (_result, input) =>
        invalidateResource(
          queryClient,
          AdminCreateSchema.parse(input).resource,
        ),
    }),
    update: mutationOptions({
      mutationFn: async (input: AdminUpdateInput) => {
        const value = AdminUpdateSchema.parse(input);
        const headers = idempotencyHeaders();
        switch (value.resource) {
          case "users":
            return apiClient.request(administrationEndpoints.updateUser, {
              headers,
              params: { id: value.id },
              body: {
                displayName: value.displayName,
                status: value.status,
                roleIds: value.roleIds,
              },
            });
          case "roles":
            return apiClient.request(administrationEndpoints.updateRole, {
              headers,
              params: { id: value.id },
              body: {
                description: value.description,
                permissions: value.permissions,
              },
            });
          case "domains":
            return apiClient.request(administrationEndpoints.updateDomain, {
              headers,
              params: { id: value.id },
              body: {
                status: value.status,
                outboundConnectionId: value.outboundConnectionId,
              },
            });
          case "provider-connections":
            return apiClient.request(
              administrationEndpoints.updateProviderConnection,
              {
                headers,
                params: { id: value.id },
                body: {
                  status: value.status,
                  apiKey: value.apiKey,
                  webhookSecret: value.webhookSecret,
                },
              },
            );
        }
      },
      onSuccess: async (_result, input) => {
        const value = AdminUpdateSchema.parse(input);
        await queryClient.invalidateQueries({
          queryKey: adminKeys.detail(value.resource, value.id),
        });
        await invalidateResource(queryClient, value.resource);
      },
    }),
    delete: mutationOptions({
      mutationFn: async (input: AdminDeleteInput) => {
        const value = AdminDeleteSchema.parse(input);
        const headers = idempotencyHeaders();
        switch (value.resource) {
          case "users":
            return apiClient.request(administrationEndpoints.deleteUser, {
              headers,
              params: { id: value.id },
            });
          case "roles":
            return apiClient.request(administrationEndpoints.deleteRole, {
              headers,
              params: { id: value.id },
            });
          case "domains":
            return apiClient.request(administrationEndpoints.deleteDomain, {
              headers,
              params: { id: value.id },
            });
          case "webhook-events":
            return apiClient.request(
              administrationEndpoints.deleteWebhookEvent,
              { headers, params: { id: value.id } },
            );
        }
      },
      onSuccess: async (_result, input) => {
        const value = AdminDeleteSchema.parse(input);
        await queryClient.invalidateQueries({
          queryKey: adminKeys.detail(value.resource, value.id),
        });
        await invalidateResource(queryClient, value.resource);
      },
    }),
  };
}

export function signatureQueryOptions(domainId: string) {
  return queryOptions({
    queryKey: adminKeys.signature(domainId),
    enabled: Boolean(domainId.trim()),
    queryFn: () =>
      apiClient.request(administrationEndpoints.signature, {
        params: { id: domainId.trim() },
      }),
  });
}

export function saveSignatureMutationOptions(
  queryClient: QueryClient,
  domainId: string,
) {
  return mutationOptions({
    mutationFn: (
      body: EndpointRequest<
        typeof administrationEndpoints.saveSignature
      >["body"],
    ) =>
      apiClient.request(administrationEndpoints.saveSignature, {
        headers: idempotencyHeaders(),
        params: { id: domainId.trim() },
        body,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: adminKeys.signature(domainId),
      });
      await invalidateResource(queryClient, "signatures");
    },
  });
}

export function saveSettingsMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: (
      body: EndpointRequest<
        typeof administrationEndpoints.saveSettings
      >["body"],
    ) =>
      apiClient.request(administrationEndpoints.saveSettings, {
        headers: idempotencyHeaders(),
        body,
      }),
    onSuccess: async () => invalidateResource(queryClient, "settings"),
  });
}

export function providerSyncMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: () =>
      apiClient.request(administrationEndpoints.providerSync, {
        headers: idempotencyHeaders(),
      }),
    onSuccess: async () => {
      await invalidateResource(queryClient, "provider-connections");
      await queryClient.invalidateQueries({
        queryKey: adminKeys.resource("webhook-events"),
      });
    },
  });
}
