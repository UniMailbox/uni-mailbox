import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Activity,
  ArrowLeft,
  Cable,
  Globe2,
  KeyRound,
  RefreshCw,
  ScrollText,
  Settings2,
  Shield,
  Users,
  Webhook,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
  AdminResourceKey,
  EndpointResponse,
  PermissionKey,
  administrationEndpoints,
} from "@unimailbox/contracts";
import { ErrorState, LoadingState, SuccessNote } from "../../components/Status";
import { BidiText } from "../../components/BidiText";
import {
  FieldError,
  useAppFieldContext,
  useAppForm,
} from "../../lib/form/app-form";
import { sessionQueryOptions } from "../auth/api";
import {
  adminFormSchemas,
  adminMutationOptions,
  adminQueryOptions,
  canAdminWrite,
  providerSyncMutationOptions,
  saveSettingsMutationOptions,
  saveSignatureMutationOptions,
  signatureQueryOptions,
} from "./api";

const navigation: Array<
  [AdminResourceKey, React.ComponentType<{ className?: string }>]
> = [
  ["users", Users],
  ["roles", Shield],
  ["domains", Globe2],
  ["signatures", ScrollText],
  ["settings", Settings2],
  ["provider-connections", Cable],
  ["webhook-events", Webhook],
  ["audit-events", KeyRound],
  ["analytics", Activity],
];
const columnKeys = [
  "id",
  "email",
  "display_name",
  "status",
  "created_at",
  "roles",
  "name",
  "description",
  "is_system",
  "permissions",
  "outbound_connection_id",
  "provider_key",
  "provider_label",
  "label",
  "event_type",
  "provider_message_id",
  "message_id",
  "recipient",
  "mapped_status",
  "reason",
  "action",
  "resource_type",
  "resource_id",
  "request_id",
  "metadata_json",
  "active_users",
  "active_mailboxes",
  "received_messages",
  "sent_messages",
  "failed_jobs",
  "failed_webhooks",
] as const;
const columnKeySet = new Set<string>(columnKeys);
const localizedValues = new Set([
  "active",
  "suspended",
  "disabled",
  "deleted",
  "draft",
  "queued",
  "sending",
  "sent",
  "delayed",
  "delivered",
  "bounced",
  "failed",
  "complained",
  "received",
  "reject",
  "store",
]);

type AdminColumnKey = (typeof columnKeys)[number];
type AdminCell = string | number | boolean | null;
type AdminTableRow = Partial<
  Record<
    | AdminColumnKey
    | "site_title"
    | "registration_enabled"
    | "invite_required"
    | "inbound_enabled"
    | "outbound_enabled"
    | "unknown_recipient_policy"
    | "max_mailboxes_per_user"
    | "max_attachments_per_message"
    | "max_attachment_bytes",
    AdminCell
  >
>;
type AdminTableData = AdminTableRow | AdminTableRow[] | undefined;
type Domain = EndpointResponse<typeof administrationEndpoints.domains>[number];
type Settings = EndpointResponse<typeof administrationEndpoints.settings>;

const technicalFieldLabels = new Set([
  "id",
  "email",
  "roleIds",
  "permissions",
  "apiKey",
  "webhookSecret",
  "outboundConnectionId",
  "htmlSignature",
]);

function technicalFieldDirection(label: string): "ltr" | undefined {
  return technicalFieldLabels.has(label) ? "ltr" : undefined;
}

function AdminTextField({
  label,
  type = "text",
  autoComplete,
  inputMode,
  disabled = false,
  technical = false,
}: {
  label: string;
  type?: "email" | "password" | "text";
  autoComplete?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  disabled?: boolean;
  technical?: boolean;
}) {
  const field = useAppFieldContext<string>();
  const { t } = useTranslation("admin");
  return (
    <label className="field" htmlFor={field.name}>
      <span>{t(`fields.${label}`)}</span>
      <input
        autoComplete={autoComplete}
        dir={technical ? "ltr" : technicalFieldDirection(label)}
        disabled={disabled}
        id={field.name}
        inputMode={inputMode}
        onBlur={field.handleBlur}
        onChange={(event) => field.handleChange(event.target.value)}
        type={type}
        value={field.state.value}
      />
      <FieldError labelKey={`admin:fields.${label}`} />
    </label>
  );
}

function AdminTextArea({
  label,
  disabled = false,
}: {
  label: string;
  disabled?: boolean;
}) {
  const field = useAppFieldContext<string>();
  const { t } = useTranslation("admin");
  return (
    <label className="field" htmlFor={field.name}>
      <span>{t(`fields.${label}`)}</span>
      <textarea
        dir={technicalFieldDirection(label)}
        disabled={disabled}
        id={field.name}
        onBlur={field.handleBlur}
        onChange={(event) => field.handleChange(event.target.value)}
        value={field.state.value}
      />
      <FieldError labelKey={`admin:fields.${label}`} />
    </label>
  );
}

function AdminSelectField({
  label,
  children,
  disabled = false,
}: {
  label: string;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  const field = useAppFieldContext<string>();
  const { t } = useTranslation("admin");
  return (
    <label className="field" htmlFor={field.name}>
      <span>{t(`fields.${label}`)}</span>
      <select
        disabled={disabled}
        id={field.name}
        onBlur={field.handleBlur}
        onChange={(event) => field.handleChange(event.target.value)}
        value={field.state.value}
      >
        {children}
      </select>
      <FieldError labelKey={`admin:fields.${label}`} />
    </label>
  );
}

function AdminNumberField({
  label,
  disabled = false,
}: {
  label: string;
  disabled?: boolean;
}) {
  const field = useAppFieldContext<number>();
  const { t } = useTranslation("admin");
  return (
    <label className="field" htmlFor={field.name}>
      <span>{t(`fields.${label}`)}</span>
      <input
        disabled={disabled}
        id={field.name}
        min="0"
        onBlur={field.handleBlur}
        onChange={(event) => field.handleChange(Number(event.target.value))}
        type="number"
        value={field.state.value}
      />
      <FieldError labelKey={`admin:fields.${label}`} />
    </label>
  );
}

function AdminBooleanField({
  label,
  disabled = false,
}: {
  label: string;
  disabled?: boolean;
}) {
  const field = useAppFieldContext<number>();
  const { t } = useTranslation("admin");
  return (
    <label className="check-field">
      <input
        checked={field.state.value === 1}
        disabled={disabled}
        onBlur={field.handleBlur}
        onChange={(event) => field.handleChange(Number(event.target.checked))}
        type="checkbox"
      />
      {t(`fields.${label}`)}
      <FieldError labelKey={`admin:fields.${label}`} />
    </label>
  );
}

function DataTable({ data }: { data: AdminTableData }) {
  const { t } = useTranslation("admin");
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  const columns = [
    ...new Set(
      rows.flatMap((row) =>
        Object.keys(row).filter((key) => columnKeySet.has(key)),
      ),
    ),
  ];
  if (!rows.length)
    return (
      <div className="empty-admin">
        <strong>{t("states.emptyTitle")}</strong>
        <p>{t("states.emptyBody")}</p>
      </div>
    );
  const value = (key: string, raw: AdminCell | undefined) => {
    if (
      key === "reason" ||
      key === "metadata_json" ||
      raw === null ||
      raw === undefined ||
      raw === ""
    )
      return t("values.empty");
    if (typeof raw === "boolean")
      return t(raw ? "values.true" : "values.false");
    if (typeof raw === "string" && localizedValues.has(raw))
      return t(`values.${raw}`);
    return <BidiText kind="identifier">{String(raw)}</BidiText>;
  };
  return (
    <div className="data-table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{t(`columns.${column}`)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={String(row.id ?? index)}>
              {columns.map((column) => (
                <td key={column}>
                  {value(column, row[column as AdminColumnKey])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CreateUserPanel() {
  const { t } = useTranslation("admin");
  const client = useQueryClient();
  const mutation = useMutation(adminMutationOptions(client).create);
  const form = useAppForm({
    defaultValues: { displayName: "", email: "", password: "", roleIds: "" },
    validators: { onSubmit: adminFormSchemas.createUser },
    onSubmit: async ({ value }) => {
      await mutation.mutateAsync({
        resource: "users",
        ...adminFormSchemas.createUser.parse(value),
      });
      form.reset();
    },
  });
  return (
    <details className="create-panel">
      <summary>{t("actions.add", { resource: t("navigation.users") })}</summary>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.AppField name="displayName">
          {() => <AdminTextField label="displayName" />}
        </form.AppField>
        <form.AppField name="email">
          {() => (
            <AdminTextField
              autoComplete="email"
              inputMode="email"
              label="email"
              type="email"
            />
          )}
        </form.AppField>
        <form.AppField name="password">
          {() => (
            <AdminTextField
              autoComplete="new-password"
              label="password"
              type="password"
            />
          )}
        </form.AppField>
        <form.AppField name="roleIds">
          {() => <AdminTextField label="roleIds" />}
        </form.AppField>
        {mutation.error ? <ErrorState error={mutation.error} /> : null}
        <form.Subscribe
          selector={(state) => [state.canSubmit, state.isSubmitting] as const}
        >
          {([canSubmit, isSubmitting]) => (
            <button
              className="button primary"
              disabled={!canSubmit || isSubmitting || mutation.isPending}
              type="submit"
            >
              {t("actions.create")}
            </button>
          )}
        </form.Subscribe>
      </form>
    </details>
  );
}

function CreateRolePanel() {
  const { t } = useTranslation("admin");
  const client = useQueryClient();
  const mutation = useMutation(adminMutationOptions(client).create);
  const form = useAppForm({
    defaultValues: { name: "", description: "", permissions: "" },
    validators: { onSubmit: adminFormSchemas.createRole },
    onSubmit: async ({ value }) => {
      await mutation.mutateAsync({
        resource: "roles",
        ...adminFormSchemas.createRole.parse(value),
      });
      form.reset();
    },
  });
  return (
    <details className="create-panel">
      <summary>{t("actions.add", { resource: t("navigation.roles") })}</summary>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.AppField name="name">
          {() => <AdminTextField label="name" />}
        </form.AppField>
        <form.AppField name="description">
          {() => <AdminTextArea label="description" />}
        </form.AppField>
        <form.AppField name="permissions">
          {() => <AdminTextField label="permissions" />}
        </form.AppField>
        {mutation.error ? <ErrorState error={mutation.error} /> : null}
        <form.Subscribe
          selector={(state) => [state.canSubmit, state.isSubmitting] as const}
        >
          {([canSubmit, isSubmitting]) => (
            <button
              className="button primary"
              disabled={!canSubmit || isSubmitting || mutation.isPending}
              type="submit"
            >
              {t("actions.create")}
            </button>
          )}
        </form.Subscribe>
      </form>
    </details>
  );
}

function CreateDomainPanel() {
  const { t } = useTranslation("admin");
  const client = useQueryClient();
  const mutation = useMutation(adminMutationOptions(client).create);
  const form = useAppForm({
    defaultValues: { name: "" },
    validators: { onSubmit: adminFormSchemas.createDomain },
    onSubmit: async ({ value }) => {
      await mutation.mutateAsync({
        resource: "domains",
        ...adminFormSchemas.createDomain.parse(value),
      });
      form.reset();
    },
  });
  return (
    <details className="create-panel">
      <summary>
        {t("actions.add", { resource: t("navigation.domains") })}
      </summary>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.AppField name="name">
          {() => <AdminTextField label="name" technical />}
        </form.AppField>
        {mutation.error ? <ErrorState error={mutation.error} /> : null}
        <form.Subscribe
          selector={(state) => [state.canSubmit, state.isSubmitting] as const}
        >
          {([canSubmit, isSubmitting]) => (
            <button
              className="button primary"
              disabled={!canSubmit || isSubmitting || mutation.isPending}
              type="submit"
            >
              {t("actions.create")}
            </button>
          )}
        </form.Subscribe>
      </form>
    </details>
  );
}

function CreateProviderPanel() {
  const { t } = useTranslation("admin");
  const client = useQueryClient();
  const mutation = useMutation(adminMutationOptions(client).create);
  const form = useAppForm({
    defaultValues: {
      providerKey: "brevo",
      label: "",
      apiKey: "",
      webhookSecret: "",
    },
    validators: { onSubmit: adminFormSchemas.createProviderConnection },
    onSubmit: async ({ value }) => {
      await mutation.mutateAsync({
        resource: "provider-connections",
        ...adminFormSchemas.createProviderConnection.parse(value),
      });
      form.reset();
    },
  });
  return (
    <details className="create-panel">
      <summary>
        {t("actions.add", { resource: t("navigation.provider-connections") })}
      </summary>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.AppField name="label">
          {() => <AdminTextField label="label" />}
        </form.AppField>
        <form.AppField name="apiKey">
          {() => (
            <AdminTextField
              autoComplete="new-password"
              label="apiKey"
              type="password"
            />
          )}
        </form.AppField>
        <form.AppField name="webhookSecret">
          {() => (
            <AdminTextField
              autoComplete="new-password"
              label="webhookSecret"
              type="password"
            />
          )}
        </form.AppField>
        {mutation.error ? <ErrorState error={mutation.error} /> : null}
        <form.Subscribe
          selector={(state) => [state.canSubmit, state.isSubmitting] as const}
        >
          {([canSubmit, isSubmitting]) => (
            <button
              className="button primary"
              disabled={!canSubmit || isSubmitting || mutation.isPending}
              type="submit"
            >
              {t("actions.create")}
            </button>
          )}
        </form.Subscribe>
      </form>
    </details>
  );
}

function CreatePanel({
  resource,
  permissions,
}: {
  resource: AdminResourceKey;
  permissions: readonly PermissionKey[];
}) {
  switch (resource) {
    case "users":
      return canAdminWrite("users", permissions) ? <CreateUserPanel /> : null;
    case "roles":
      return canAdminWrite("roles", permissions) ? <CreateRolePanel /> : null;
    case "domains":
      return canAdminWrite("domains", permissions) ? (
        <CreateDomainPanel />
      ) : null;
    case "provider-connections":
      return canAdminWrite("provider-connections", permissions) ? (
        <CreateProviderPanel />
      ) : null;
    default:
      return null;
  }
}

function ManageUserPanel() {
  const { t } = useTranslation("admin");
  const client = useQueryClient();
  const mutations = adminMutationOptions(client);
  const update = useMutation(mutations.update);
  const remove = useMutation(mutations.delete);
  const form = useAppForm({
    defaultValues: {
      action: "update" as "update" | "delete",
      id: "",
      displayName: "",
      status: "",
      roleIds: "",
    },
    validators: { onSubmit: adminFormSchemas.manageUser },
    onSubmit: async ({ value }) => {
      const input = adminFormSchemas.manageUser.parse(value);
      if (input.action === "delete")
        await remove.mutateAsync({ resource: "users", id: input.id });
      else
        await update.mutateAsync({
          resource: "users",
          id: input.id,
          ...(input.displayName ? { displayName: input.displayName } : {}),
          ...(input.status ? { status: input.status } : {}),
          ...(input.roleIds ? { roleIds: input.roleIds } : {}),
        });
      form.reset();
    },
  });
  return (
    <details className="create-panel">
      <summary>
        {t("actions.manage", { resource: t("navigation.users") })}
      </summary>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.AppField name="id">
          {() => <AdminTextField label="id" />}
        </form.AppField>
        <form.AppField name="action">
          {() => (
            <AdminSelectField label="action">
              <option value="update">{t("values.update")}</option>
              <option value="delete">{t("values.delete")}</option>
            </AdminSelectField>
          )}
        </form.AppField>
        <form.AppField name="displayName">
          {() => <AdminTextField label="displayName" />}
        </form.AppField>
        <form.AppField name="status">
          {() => (
            <AdminSelectField label="status">
              <option value="">{t("values.unchanged")}</option>
              <option value="active">{t("values.active")}</option>
              <option value="suspended">{t("values.suspended")}</option>
            </AdminSelectField>
          )}
        </form.AppField>
        <form.AppField name="roleIds">
          {() => <AdminTextField label="roleIds" />}
        </form.AppField>
        {(update.error ?? remove.error) ? (
          <ErrorState error={update.error ?? remove.error} />
        ) : null}
        <form.Subscribe
          selector={(state) => [state.canSubmit, state.isSubmitting] as const}
        >
          {([canSubmit, isSubmitting]) => (
            <button
              className="button primary"
              disabled={
                !canSubmit ||
                isSubmitting ||
                update.isPending ||
                remove.isPending
              }
              type="submit"
            >
              {t("actions.update")}
            </button>
          )}
        </form.Subscribe>
      </form>
    </details>
  );
}

function ManageRolePanel() {
  const { t } = useTranslation("admin");
  const client = useQueryClient();
  const mutations = adminMutationOptions(client);
  const update = useMutation(mutations.update);
  const remove = useMutation(mutations.delete);
  const form = useAppForm({
    defaultValues: {
      action: "update" as "update" | "delete",
      id: "",
      description: "",
      permissions: "",
    },
    validators: { onSubmit: adminFormSchemas.manageRole },
    onSubmit: async ({ value }) => {
      const input = adminFormSchemas.manageRole.parse(value);
      if (input.action === "delete")
        await remove.mutateAsync({ resource: "roles", id: input.id });
      else
        await update.mutateAsync({
          resource: "roles",
          id: input.id,
          description: input.description,
          permissions: input.permissions,
        });
      form.reset();
    },
  });
  return (
    <details className="create-panel">
      <summary>
        {t("actions.manage", { resource: t("navigation.roles") })}
      </summary>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.AppField name="id">
          {() => <AdminTextField label="id" />}
        </form.AppField>
        <form.AppField name="action">
          {() => (
            <AdminSelectField label="action">
              <option value="update">{t("values.update")}</option>
              <option value="delete">{t("values.delete")}</option>
            </AdminSelectField>
          )}
        </form.AppField>
        <form.AppField name="description">
          {() => <AdminTextArea label="description" />}
        </form.AppField>
        <form.AppField name="permissions">
          {() => <AdminTextField label="permissions" />}
        </form.AppField>
        {(update.error ?? remove.error) ? (
          <ErrorState error={update.error ?? remove.error} />
        ) : null}
        <form.Subscribe
          selector={(state) => [state.canSubmit, state.isSubmitting] as const}
        >
          {([canSubmit, isSubmitting]) => (
            <button
              className="button primary"
              disabled={
                !canSubmit ||
                isSubmitting ||
                update.isPending ||
                remove.isPending
              }
              type="submit"
            >
              {t("actions.update")}
            </button>
          )}
        </form.Subscribe>
      </form>
    </details>
  );
}

function ManageDomainPanel() {
  const { t } = useTranslation("admin");
  const client = useQueryClient();
  const mutations = adminMutationOptions(client);
  const update = useMutation(mutations.update);
  const remove = useMutation(mutations.delete);
  const form = useAppForm({
    defaultValues: {
      action: "update" as "update" | "delete",
      id: "",
      status: "",
      outboundConnectionId: "",
    },
    validators: { onSubmit: adminFormSchemas.manageDomain },
    onSubmit: async ({ value }) => {
      const input = adminFormSchemas.manageDomain.parse(value);
      if (input.action === "delete")
        await remove.mutateAsync({ resource: "domains", id: input.id });
      else
        await update.mutateAsync({
          resource: "domains",
          id: input.id,
          ...(input.status ? { status: input.status } : {}),
          ...(input.outboundConnectionId
            ? { outboundConnectionId: input.outboundConnectionId }
            : {}),
        });
      form.reset();
    },
  });
  return (
    <details className="create-panel">
      <summary>
        {t("actions.manage", { resource: t("navigation.domains") })}
      </summary>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.AppField name="id">
          {() => <AdminTextField label="id" />}
        </form.AppField>
        <form.AppField name="action">
          {() => (
            <AdminSelectField label="action">
              <option value="update">{t("values.update")}</option>
              <option value="delete">{t("values.delete")}</option>
            </AdminSelectField>
          )}
        </form.AppField>
        <form.AppField name="status">
          {() => (
            <AdminSelectField label="status">
              <option value="">{t("values.unchanged")}</option>
              <option value="active">{t("values.active")}</option>
              <option value="disabled">{t("values.disabled")}</option>
            </AdminSelectField>
          )}
        </form.AppField>
        <form.AppField name="outboundConnectionId">
          {() => <AdminTextField label="outboundConnectionId" />}
        </form.AppField>
        {(update.error ?? remove.error) ? (
          <ErrorState error={update.error ?? remove.error} />
        ) : null}
        <form.Subscribe
          selector={(state) => [state.canSubmit, state.isSubmitting] as const}
        >
          {([canSubmit, isSubmitting]) => (
            <button
              className="button primary"
              disabled={
                !canSubmit ||
                isSubmitting ||
                update.isPending ||
                remove.isPending
              }
              type="submit"
            >
              {t("actions.update")}
            </button>
          )}
        </form.Subscribe>
      </form>
    </details>
  );
}

function ManageProviderPanel() {
  const { t } = useTranslation("admin");
  const client = useQueryClient();
  const update = useMutation(adminMutationOptions(client).update);
  const form = useAppForm({
    defaultValues: { id: "", status: "", apiKey: "", webhookSecret: "" },
    validators: { onSubmit: adminFormSchemas.manageProviderConnection },
    onSubmit: async ({ value }) => {
      const input = adminFormSchemas.manageProviderConnection.parse(value);
      await update.mutateAsync({
        resource: "provider-connections",
        id: input.id,
        ...(input.status ? { status: input.status } : {}),
        ...(input.apiKey ? { apiKey: input.apiKey } : {}),
        ...(input.webhookSecret ? { webhookSecret: input.webhookSecret } : {}),
      });
      form.reset();
    },
  });
  return (
    <details className="create-panel">
      <summary>
        {t("actions.manage", {
          resource: t("navigation.provider-connections"),
        })}
      </summary>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.AppField name="id">
          {() => <AdminTextField label="id" />}
        </form.AppField>
        <form.AppField name="status">
          {() => (
            <AdminSelectField label="status">
              <option value="">{t("values.unchanged")}</option>
              <option value="active">{t("values.active")}</option>
              <option value="disabled">{t("values.disabled")}</option>
            </AdminSelectField>
          )}
        </form.AppField>
        <form.AppField name="apiKey">
          {() => (
            <AdminTextField
              autoComplete="new-password"
              label="apiKey"
              type="password"
            />
          )}
        </form.AppField>
        <form.AppField name="webhookSecret">
          {() => (
            <AdminTextField
              autoComplete="new-password"
              label="webhookSecret"
              type="password"
            />
          )}
        </form.AppField>
        {update.error ? <ErrorState error={update.error} /> : null}
        <form.Subscribe
          selector={(state) => [state.canSubmit, state.isSubmitting] as const}
        >
          {([canSubmit, isSubmitting]) => (
            <button
              className="button primary"
              disabled={!canSubmit || isSubmitting || update.isPending}
              type="submit"
            >
              {t("actions.update")}
            </button>
          )}
        </form.Subscribe>
      </form>
    </details>
  );
}

function DeleteWebhookPanel() {
  const { t } = useTranslation("admin");
  const client = useQueryClient();
  const remove = useMutation(adminMutationOptions(client).delete);
  const form = useAppForm({
    defaultValues: { id: "" },
    validators: { onSubmit: adminFormSchemas.deleteWebhookEvent },
    onSubmit: async ({ value }) => {
      await remove.mutateAsync({
        resource: "webhook-events",
        ...adminFormSchemas.deleteWebhookEvent.parse(value),
      });
      form.reset();
    },
  });
  return (
    <details className="create-panel">
      <summary>
        {t("actions.manage", { resource: t("navigation.webhook-events") })}
      </summary>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.AppField name="id">
          {() => <AdminTextField label="id" />}
        </form.AppField>
        {remove.error ? <ErrorState error={remove.error} /> : null}
        <form.Subscribe
          selector={(state) => [state.canSubmit, state.isSubmitting] as const}
        >
          {([canSubmit, isSubmitting]) => (
            <button
              className="button primary"
              disabled={!canSubmit || isSubmitting || remove.isPending}
              type="submit"
            >
              {t("actions.delete")}
            </button>
          )}
        </form.Subscribe>
      </form>
    </details>
  );
}

function ManagePanel({
  resource,
  permissions,
}: {
  resource: AdminResourceKey;
  permissions: readonly PermissionKey[];
}) {
  switch (resource) {
    case "users":
      return canAdminWrite("users", permissions) ? <ManageUserPanel /> : null;
    case "roles":
      return canAdminWrite("roles", permissions) ? <ManageRolePanel /> : null;
    case "domains":
      return canAdminWrite("domains", permissions) ? (
        <ManageDomainPanel />
      ) : null;
    case "provider-connections":
      return canAdminWrite("provider-connections", permissions) ? (
        <ManageProviderPanel />
      ) : null;
    case "webhook-events":
      return canAdminWrite("webhook-events", permissions) ? (
        <DeleteWebhookPanel />
      ) : null;
    default:
      return null;
  }
}

function SignatureEditor({
  domains,
  canSave,
}: {
  domains: Domain[];
  canSave: boolean;
}) {
  const { t } = useTranslation("admin");
  const client = useQueryClient();
  const [domainId, setDomainId] = useState("");
  const signature = useQuery(signatureQueryOptions(domainId));
  const save = useMutation(saveSignatureMutationOptions(client, domainId));
  const form = useAppForm({
    defaultValues: { html: "", text: "", enabled: false },
    validators: { onSubmit: adminFormSchemas.signature },
    onSubmit: async ({ value }) => {
      await save.mutateAsync(value);
    },
  });
  useEffect(() => {
    if (!domainId && domains[0]) setDomainId(domains[0].id);
  }, [domainId, domains]);
  useEffect(() => {
    if (signature.data)
      form.reset({
        html: signature.data.html_content,
        text: signature.data.text_content,
        enabled: Boolean(signature.data.is_enabled),
      });
  }, [form, signature.data]);
  return (
    <section className="admin-editor">
      <h2>{t("navigation.signatures")}</h2>
      <label className="field">
        <span>{t("fields.domain")}</span>
        <select
          dir="ltr"
          onChange={(event) => setDomainId(event.target.value)}
          value={domainId}
        >
          {domains.map((domain) => (
            <option key={domain.id} value={domain.id}>
              {domain.name}
            </option>
          ))}
        </select>
      </label>
      {signature.isLoading ? <LoadingState /> : null}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.AppField name="text">
          {() => <AdminTextArea disabled={!canSave} label="plainSignature" />}
        </form.AppField>
        <form.AppField name="html">
          {() => <AdminTextArea disabled={!canSave} label="htmlSignature" />}
        </form.AppField>
        <form.AppField name="enabled">
          {() => <SignatureEnabledField disabled={!canSave} />}
        </form.AppField>
        {save.error ? <ErrorState error={save.error} /> : null}
        {save.isSuccess ? (
          <SuccessNote>{t("states.signatureSaved")}</SuccessNote>
        ) : null}
        {canSave ? (
          <form.Subscribe
            selector={(state) => [state.canSubmit, state.isSubmitting] as const}
          >
            {([canSubmit, isSubmitting]) => (
              <button
                className="button primary"
                disabled={
                  !canSubmit || isSubmitting || save.isPending || !domainId
                }
                type="submit"
              >
                {t("actions.saveSignature")}
              </button>
            )}
          </form.Subscribe>
        ) : null}
      </form>
    </section>
  );
}

function SignatureEnabledField({ disabled }: { disabled: boolean }) {
  const field = useAppFieldContext<boolean>();
  const { t } = useTranslation("admin");
  return (
    <label className="check-field">
      <input
        checked={field.state.value}
        disabled={disabled}
        onBlur={field.handleBlur}
        onChange={(event) => field.handleChange(event.target.checked)}
        type="checkbox"
      />
      {t("fields.enabled")}
      <FieldError labelKey="admin:fields.enabled" />
    </label>
  );
}

function isDomain(value: AdminTableRow): value is Domain {
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    (value.status === "active" || value.status === "disabled")
  );
}

function isSettings(value: AdminTableData): value is Settings {
  return (
    !Array.isArray(value) &&
    value !== undefined &&
    typeof value.site_title === "string" &&
    typeof value.registration_enabled === "number" &&
    typeof value.invite_required === "number" &&
    typeof value.inbound_enabled === "number" &&
    typeof value.outbound_enabled === "number" &&
    (value.unknown_recipient_policy === "reject" ||
      value.unknown_recipient_policy === "store") &&
    typeof value.max_mailboxes_per_user === "number" &&
    typeof value.max_attachments_per_message === "number" &&
    typeof value.max_attachment_bytes === "number"
  );
}

function SettingsEditor({
  settings,
  canSave,
}: {
  settings: Settings;
  canSave: boolean;
}) {
  const { t } = useTranslation("admin");
  const client = useQueryClient();
  const save = useMutation(saveSettingsMutationOptions(client));
  const form = useAppForm({
    defaultValues: {
      site_title: settings.site_title,
      registration_enabled: settings.registration_enabled,
      invite_required: settings.invite_required,
      inbound_enabled: settings.inbound_enabled,
      outbound_enabled: settings.outbound_enabled,
      unknown_recipient_policy: settings.unknown_recipient_policy,
      max_mailboxes_per_user: settings.max_mailboxes_per_user,
      max_attachments_per_message: settings.max_attachments_per_message,
      max_attachment_bytes: settings.max_attachment_bytes,
    },
    validators: { onSubmit: adminFormSchemas.settings },
    onSubmit: async ({ value }) => {
      await save.mutateAsync(value);
    },
  });
  useEffect(() => {
    form.reset({
      site_title: settings.site_title,
      registration_enabled: settings.registration_enabled,
      invite_required: settings.invite_required,
      inbound_enabled: settings.inbound_enabled,
      outbound_enabled: settings.outbound_enabled,
      unknown_recipient_policy: settings.unknown_recipient_policy,
      max_mailboxes_per_user: settings.max_mailboxes_per_user,
      max_attachments_per_message: settings.max_attachments_per_message,
      max_attachment_bytes: settings.max_attachment_bytes,
    });
  }, [form, settings]);
  return (
    <section className="admin-editor">
      <h2>{t("navigation.settings")}</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.AppField name="site_title">
          {() => <AdminTextField disabled={!canSave} label="siteTitle" />}
        </form.AppField>
        <form.AppField name="max_mailboxes_per_user">
          {() => (
            <AdminNumberField disabled={!canSave} label="mailboxesPerUser" />
          )}
        </form.AppField>
        <form.AppField name="max_attachments_per_message">
          {() => (
            <AdminNumberField
              disabled={!canSave}
              label="attachmentsPerMessage"
            />
          )}
        </form.AppField>
        <form.AppField name="max_attachment_bytes">
          {() => (
            <AdminNumberField disabled={!canSave} label="attachmentBytes" />
          )}
        </form.AppField>
        <form.AppField name="unknown_recipient_policy">
          {() => (
            <AdminSelectField
              disabled={!canSave}
              label="unknownRecipientPolicy"
            >
              <option value="reject">{t("values.reject")}</option>
              <option value="store">{t("values.store")}</option>
            </AdminSelectField>
          )}
        </form.AppField>
        <form.AppField name="registration_enabled">
          {() => (
            <AdminBooleanField
              disabled={!canSave}
              label="registrationEnabled"
            />
          )}
        </form.AppField>
        <form.AppField name="invite_required">
          {() => (
            <AdminBooleanField disabled={!canSave} label="inviteRequired" />
          )}
        </form.AppField>
        <form.AppField name="inbound_enabled">
          {() => (
            <AdminBooleanField disabled={!canSave} label="inboundEnabled" />
          )}
        </form.AppField>
        <form.AppField name="outbound_enabled">
          {() => (
            <AdminBooleanField disabled={!canSave} label="outboundEnabled" />
          )}
        </form.AppField>
        {save.error ? <ErrorState error={save.error} /> : null}
        {save.isSuccess ? (
          <SuccessNote>{t("states.settingsSaved")}</SuccessNote>
        ) : null}
        {canSave ? (
          <form.Subscribe
            selector={(state) => [state.canSubmit, state.isSubmitting] as const}
          >
            {([canSubmit, isSubmitting]) => (
              <button
                className="button primary"
                disabled={!canSubmit || isSubmitting || save.isPending}
                type="submit"
              >
                {t("actions.saveSettings")}
              </button>
            )}
          </form.Subscribe>
        ) : null}
      </form>
    </section>
  );
}

export function AdminPage({ resource }: { resource: AdminResourceKey }) {
  const { t } = useTranslation("admin");
  const client = useQueryClient();
  const [auditSearch, setAuditSearch] = useState("");
  const query = useQuery(adminQueryOptions(resource, auditSearch));
  const sync = useMutation(providerSyncMutationOptions(client));
  const session = useQuery(sessionQueryOptions());
  const permissions = session.data?.permissions ?? [];
  const data = query.data;
  const domains =
    resource === "signatures" && Array.isArray(data)
      ? data.filter(isDomain)
      : [];
  const settings =
    resource === "settings" && isSettings(data) ? data : undefined;
  return (
    <div className="admin-app">
      <aside className="admin-sidebar">
        <Link className="wordmark compact" to="/inbox">
          <span>CM</span> UniMailbox
        </Link>
        <div className="admin-rail-title">{t("controlPlane")}</div>
        <nav>
          {navigation.map(([id, Icon]) => (
            <Link
              aria-current={id === resource ? "page" : undefined}
              className={id === resource ? "active" : ""}
              key={id}
              to={`/admin/${id}`}
            >
              <Icon aria-hidden="true" />
              {t(`navigation.${id}`)}
            </Link>
          ))}
        </nav>
        <Link className="back-link" to="/inbox">
          <ArrowLeft aria-hidden="true" className="directional-icon" />
          {t("backToMail")}
        </Link>
      </aside>
      <main className="admin-main">
        <header>
          <div>
            <div className="section-kicker">{t("title")}</div>
            <h1>{t(`navigation.${resource}`)}</h1>
          </div>
          {resource === "provider-connections" &&
          canAdminWrite("provider-sync", permissions) ? (
            <button
              className="button secondary"
              disabled={sync.isPending}
              onClick={() => sync.mutate()}
              type="button"
            >
              <RefreshCw
                aria-hidden="true"
                className={sync.isPending ? "spin" : ""}
              />
              {t("actions.reconcile")}
            </button>
          ) : null}
        </header>
        <section className="admin-surface">
          <div className="surface-heading">
            <div>
              <span className="status-pill">{t("live")}</span>
              <strong>
                {t("registry", { resource: t(`navigation.${resource}`) })}
              </strong>
            </div>
            <small>{t("audited")}</small>
          </div>
          {resource === "audit-events" ? (
            <label className="admin-search">
              <span>{t("search.label")}</span>
              <input
                onChange={(event) => setAuditSearch(event.target.value)}
                placeholder={t("search.placeholder")}
                value={auditSearch}
              />
            </label>
          ) : null}
          {sync.isSuccess ? (
            <SuccessNote>{t("states.syncComplete")}</SuccessNote>
          ) : null}
          {query.isLoading ? (
            <LoadingState />
          ) : query.error ? (
            <ErrorState
              error={query.error}
              retry={() => void query.refetch()}
            />
          ) : (
            <>
              <DataTable data={data} />
              {resource === "signatures" ? (
                <SignatureEditor
                  canSave={canAdminWrite("signatures", permissions)}
                  domains={domains}
                />
              ) : null}
              {settings ? (
                <SettingsEditor
                  canSave={canAdminWrite("settings", permissions)}
                  settings={settings}
                />
              ) : null}
            </>
          )}
        </section>
        <CreatePanel permissions={permissions} resource={resource} />
        <ManagePanel permissions={permissions} resource={resource} />
      </main>
    </div>
  );
}
