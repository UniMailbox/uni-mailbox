import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Activity,
  ArrowLeft,
  Cable,
  Eye,
  Globe2,
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  ScrollText,
  Settings2,
  Shield,
  Trash2,
  Users,
  Webhook,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
  AdminResourceKey,
  EndpointResponse,
  PermissionKey,
  administrationEndpoints,
} from "@unimailbox/contracts";
import { ErrorState, LoadingState, SuccessNote } from "../../components/Status";
import { DomainRoutingGuide } from "../../components/DomainRoutingGuide";
import { BidiText } from "../../components/BidiText";
import type { RuntimeLocale } from "../../i18n";
import { formatTimestamp } from "../../i18n/format";
import { useUiStore } from "../../lib/ui-store";
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
  providerCatalogQueryOptions,
  providerConnectionsQueryOptions,
  saveSettingsMutationOptions,
  saveSignatureMutationOptions,
  signatureQueryOptions,
  testDomainProviderMutationOptions,
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
const CloudflareSettings = lazy(() =>
  import("../settings/CloudflareSettings").then((module) => ({
    default: module.CloudflareSettings,
  })),
);
const StorageSettings = lazy(() =>
  import("../settings/StorageSettings").then((module) => ({
    default: module.StorageSettings,
  })),
);
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
  "domain_id",
  "provider_key",
  "provider_label",
  "label",
  "webhook_path",
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
type AdminRowAction = "view" | "edit" | "delete";
type SelectedAdminAction = {
  type: AdminRowAction;
  row: AdminTableRow;
};

const editableResources = new Set<AdminResourceKey>([
  "users",
  "roles",
  "domains",
  "provider-connections",
]);
const deletableResources = new Set<AdminResourceKey>([
  "users",
  "roles",
  "domains",
  "webhook-events",
]);
const creatableResources = new Set<AdminResourceKey>([
  "users",
  "roles",
  "domains",
  "provider-connections",
]);

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

function AdminDialog({
  children,
  onClose,
  title,
  tone = "default",
}: {
  children: React.ReactNode;
  onClose: () => void;
  title: string;
  tone?: "default" | "danger";
}) {
  const { t } = useTranslation("admin");
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current
      ?.querySelector<HTMLElement>(
        'button, input, select, textarea, [href], [tabindex]:not([tabindex="-1"])',
      )
      ?.focus();
    const handleKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [
        ...dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
        ),
      ];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyboard);
    return () => {
      document.removeEventListener("keydown", handleKeyboard);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, []);

  return (
    <div
      className="admin-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        aria-labelledby="admin-dialog-title"
        aria-modal="true"
        className={`admin-dialog ${tone === "danger" ? "danger" : ""}`}
        ref={dialogRef}
        role="dialog"
      >
        <header>
          <div>
            <span className="section-kicker">{t("dialog.action")}</span>
            <h2 id="admin-dialog-title">{title}</h2>
          </div>
          <button
            aria-label={t("actions.close")}
            className="icon-button"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="admin-dialog-body">{children}</div>
      </section>
    </div>
  );
}

function DataTable({
  canWrite,
  data,
  onAction,
  resource,
}: {
  canWrite: boolean;
  data: AdminTableData;
  onAction: (action: SelectedAdminAction) => void;
  resource: AdminResourceKey;
}) {
  const { t, i18n } = useTranslation("admin");
  const timeZone = useUiStore((state) => state.timeZone);
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  const columns = [
    ...new Set(
      rows.flatMap((row) =>
        Object.keys(row).filter((key) => columnKeySet.has(key)),
      ),
    ),
  ];
  const hasActions = rows.some((row) => typeof row.id === "string");
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
    if (key === "created_at" && typeof raw === "string")
      return (
        formatTimestamp(
          raw,
          i18n.resolvedLanguage as RuntimeLocale,
          timeZone,
        ) ?? <BidiText kind="identifier">{raw}</BidiText>
      );
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
            {hasActions ? (
              <th className="table-actions-heading">{t("columns.actions")}</th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const immutable =
              (resource === "roles" && row.is_system === 1) ||
              (resource === "users" && row.status === "deleted");
            const canEdit =
              canWrite && editableResources.has(resource) && !immutable;
            const canDelete =
              canWrite && deletableResources.has(resource) && !immutable;
            return (
              <tr key={String(row.id ?? index)}>
                {columns.map((column) => (
                  <td key={column}>
                    {value(column, row[column as AdminColumnKey])}
                  </td>
                ))}
                {hasActions ? (
                  <td className="table-actions">
                    <button
                      aria-label={t("actions.view")}
                      className="table-action"
                      onClick={() => onAction({ type: "view", row })}
                      title={t("actions.view")}
                      type="button"
                    >
                      <Eye aria-hidden="true" />
                    </button>
                    {canEdit ? (
                      <button
                        aria-label={t("actions.edit")}
                        className="table-action"
                        onClick={() => onAction({ type: "edit", row })}
                        title={t("actions.edit")}
                        type="button"
                      >
                        <Pencil aria-hidden="true" />
                      </button>
                    ) : null}
                    {canDelete ? (
                      <button
                        aria-label={t("actions.delete")}
                        className="table-action danger"
                        onClick={() => onAction({ type: "delete", row })}
                        title={t("actions.delete")}
                        type="button"
                      >
                        <Trash2 aria-hidden="true" />
                      </button>
                    ) : null}
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CreateUserPanel({ onClose }: { onClose: () => void }) {
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
      onClose();
    },
  });
  return (
    <form
      className="admin-action-form"
      noValidate
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
      <div className="admin-dialog-footer">
        <button className="button secondary" onClick={onClose} type="button">
          {t("actions.cancel")}
        </button>
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(isSubmitting) => (
            <button
              className="button primary"
              disabled={isSubmitting || mutation.isPending}
              type="submit"
            >
              {t("actions.create")}
            </button>
          )}
        </form.Subscribe>
      </div>
    </form>
  );
}

function CreateRolePanel({ onClose }: { onClose: () => void }) {
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
      onClose();
    },
  });
  return (
    <form
      className="admin-action-form"
      noValidate
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
      <div className="admin-dialog-footer">
        <button className="button secondary" onClick={onClose} type="button">
          {t("actions.cancel")}
        </button>
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(isSubmitting) => (
            <button
              className="button primary"
              disabled={isSubmitting || mutation.isPending}
              type="submit"
            >
              {t("actions.create")}
            </button>
          )}
        </form.Subscribe>
      </div>
    </form>
  );
}

export function CreateDomainPanel({
  onClose = () => undefined,
}: {
  onClose?: () => void;
}) {
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
  const routingConfiguration =
    mutation.data && "routingConfiguration" in mutation.data
      ? mutation.data.routingConfiguration
      : undefined;
  return (
    <div>
      <form
        className="admin-action-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.AppField name="name">
          {() => <AdminTextField label="name" technical />}
        </form.AppField>
        {mutation.error ? <ErrorState error={mutation.error} /> : null}
        <div className="admin-dialog-footer">
          <button className="button secondary" onClick={onClose} type="button">
            {t("actions.cancel")}
          </button>
          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(isSubmitting) => (
              <button
                className="button primary"
                disabled={isSubmitting || mutation.isPending}
                type="submit"
              >
                {t("actions.create")}
              </button>
            )}
          </form.Subscribe>
        </div>
      </form>
      {routingConfiguration?.status === "manual_setup_required" &&
      mutation.data &&
      "name" in mutation.data ? (
        <DomainRoutingGuide
          dashboardUrl={routingConfiguration.dashboardUrl}
          domainName={mutation.data.name}
        />
      ) : null}
    </div>
  );
}

function CreateProviderPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation("admin");
  const client = useQueryClient();
  const mutation = useMutation(adminMutationOptions(client).create);
  const catalog = useQuery(providerCatalogQueryOptions());
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
      onClose();
    },
  });
  return (
    <form
      className="admin-action-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.AppField name="providerKey">
        {() => (
          <AdminSelectField label="provider">
            {(catalog.data ?? [{ key: "brevo" }]).map((provider) => (
              <option key={provider.key} value={provider.key}>
                {t(`providers.${provider.key}`, { defaultValue: provider.key })}
              </option>
            ))}
          </AdminSelectField>
        )}
      </form.AppField>
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
      <div className="admin-dialog-footer">
        <button className="button secondary" onClick={onClose} type="button">
          {t("actions.cancel")}
        </button>
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(isSubmitting) => (
            <button
              className="button primary"
              disabled={isSubmitting || mutation.isPending}
              type="submit"
            >
              {t("actions.create")}
            </button>
          )}
        </form.Subscribe>
      </div>
    </form>
  );
}

function CreatePanel({
  onClose,
  resource,
  permissions,
}: {
  onClose: () => void;
  resource: AdminResourceKey;
  permissions: readonly PermissionKey[];
}) {
  switch (resource) {
    case "users":
      return canAdminWrite("users", permissions) ? (
        <CreateUserPanel onClose={onClose} />
      ) : null;
    case "roles":
      return canAdminWrite("roles", permissions) ? (
        <CreateRolePanel onClose={onClose} />
      ) : null;
    case "domains":
      return canAdminWrite("domains", permissions) ? (
        <CreateDomainPanel onClose={onClose} />
      ) : null;
    case "provider-connections":
      return canAdminWrite("provider-connections", permissions) ? (
        <CreateProviderPanel onClose={onClose} />
      ) : null;
    default:
      return null;
  }
}

function textCell(row: AdminTableRow, key: AdminColumnKey): string {
  const value = row[key];
  return value === null || value === undefined ? "" : String(value);
}

function ManageUserPanel({
  onClose,
  row,
}: {
  onClose: () => void;
  row: AdminTableRow;
}) {
  const { t } = useTranslation("admin");
  const client = useQueryClient();
  const update = useMutation(adminMutationOptions(client).update);
  const form = useAppForm({
    defaultValues: {
      action: "update" as const,
      id: textCell(row, "id"),
      displayName: textCell(row, "display_name"),
      status:
        row.status === "active" || row.status === "suspended" ? row.status : "",
      roleIds: "",
    },
    validators: { onSubmit: adminFormSchemas.manageUser.options[1] },
    onSubmit: async ({ value }) => {
      const input = adminFormSchemas.manageUser.options[1].parse(value);
      if (input.action === "update") {
        await update.mutateAsync({
          resource: "users",
          id: input.id,
          ...(input.displayName ? { displayName: input.displayName } : {}),
          ...(input.status ? { status: input.status } : {}),
          ...(input.roleIds ? { roleIds: input.roleIds } : {}),
        });
        onClose();
      }
    },
  });
  return (
    <form
      className="admin-action-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
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
      {update.error ? <ErrorState error={update.error} /> : null}
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(isSubmitting) => (
          <DialogFormActions
            isPending={isSubmitting || update.isPending}
            onClose={onClose}
            submitLabel={t("actions.update")}
          />
        )}
      </form.Subscribe>
    </form>
  );
}

function ManageRolePanel({
  onClose,
  row,
}: {
  onClose: () => void;
  row: AdminTableRow;
}) {
  const { t } = useTranslation("admin");
  const client = useQueryClient();
  const update = useMutation(adminMutationOptions(client).update);
  const form = useAppForm({
    defaultValues: {
      action: "update" as const,
      id: textCell(row, "id"),
      description: textCell(row, "description"),
      permissions: textCell(row, "permissions"),
    },
    validators: { onSubmit: adminFormSchemas.manageRole.options[1] },
    onSubmit: async ({ value }) => {
      const input = adminFormSchemas.manageRole.options[1].parse(value);
      if (input.action === "update") {
        await update.mutateAsync({
          resource: "roles",
          id: input.id,
          description: input.description,
          permissions: input.permissions,
        });
        onClose();
      }
    },
  });
  return (
    <form
      className="admin-action-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.AppField name="description">
        {() => <AdminTextArea label="description" />}
      </form.AppField>
      <form.AppField name="permissions">
        {() => <AdminTextField label="permissions" />}
      </form.AppField>
      {update.error ? <ErrorState error={update.error} /> : null}
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(isSubmitting) => (
          <DialogFormActions
            isPending={isSubmitting || update.isPending}
            onClose={onClose}
            submitLabel={t("actions.update")}
          />
        )}
      </form.Subscribe>
    </form>
  );
}

export function ManageDomainPanel({
  onClose,
  row,
}: {
  onClose: () => void;
  row: AdminTableRow;
}) {
  const { t } = useTranslation("admin");
  const client = useQueryClient();
  const update = useMutation(adminMutationOptions(client).update);
  const connections = useQuery(providerConnectionsQueryOptions());
  const form = useAppForm({
    defaultValues: {
      action: "update" as const,
      id: textCell(row, "id"),
      status:
        row.status === "active" || row.status === "disabled" ? row.status : "",
      outboundConnectionId: textCell(row, "outbound_connection_id"),
    },
    validators: { onSubmit: adminFormSchemas.manageDomain.options[1] },
    onSubmit: async ({ value }) => {
      const input = adminFormSchemas.manageDomain.options[1].parse(value);
      if (input.action === "update") {
        await update.mutateAsync({
          resource: "domains",
          id: input.id,
          ...(input.status ? { status: input.status } : {}),
          outboundConnectionId: input.outboundConnectionId || null,
        });
        onClose();
      }
    },
  });
  return (
    <>
      <form
        className="admin-action-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
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
          {() => (
            <AdminSelectField label="outboundProvider">
              <option value="">{t("values.noProvider")}</option>
              {(connections.data ?? [])
                .filter(
                  (connection) =>
                    connection.status === "active" ||
                    connection.id === row.outbound_connection_id,
                )
                .map((connection) => (
                  <option key={connection.id} value={connection.id}>
                    {connection.provider_key} — {connection.label}
                  </option>
                ))}
            </AdminSelectField>
          )}
        </form.AppField>
        {update.error ? <ErrorState error={update.error} /> : null}
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(isSubmitting) => (
            <DialogFormActions
              isPending={isSubmitting || update.isPending}
              onClose={onClose}
              submitLabel={t("actions.update")}
            />
          )}
        </form.Subscribe>
      </form>
      <DomainProviderTest domainId={textCell(row, "id")} />
    </>
  );
}

function DomainProviderTest({ domainId }: { domainId: string }) {
  const { t } = useTranslation("admin");
  const [email, setEmail] = useState("");
  const test = useMutation(testDomainProviderMutationOptions(domainId));
  return (
    <section className="domain-provider-test">
      <h3>{t("providerTest.heading")}</h3>
      <p>{t("providerTest.description")}</p>
      <label className="field">
        <span>{t("fields.testRecipient")}</span>
        <input
          dir="ltr"
          onChange={(event) => setEmail(event.target.value)}
          placeholder={t("providerTest.placeholder")}
          type="email"
          value={email}
        />
      </label>
      <button
        className="button secondary"
        disabled={!email.trim() || test.isPending}
        onClick={() => test.mutate(email)}
        type="button"
      >
        <Send aria-hidden="true" />
        {t("actions.sendProviderTest")}
      </button>
      {test.error ? <ErrorState error={test.error} /> : null}
      {test.isSuccess ? (
        <SuccessNote>
          {t("states.providerTestSent", {
            provider: test.data.providerKey,
            email,
          })}
        </SuccessNote>
      ) : null}
    </section>
  );
}

function ManageProviderPanel({
  onClose,
  row,
}: {
  onClose: () => void;
  row: AdminTableRow;
}) {
  const { t } = useTranslation("admin");
  const client = useQueryClient();
  const update = useMutation(adminMutationOptions(client).update);
  const form = useAppForm({
    defaultValues: {
      id: textCell(row, "id"),
      status:
        row.status === "active" || row.status === "disabled" ? row.status : "",
      apiKey: "",
      webhookSecret: "",
    },
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
      onClose();
    },
  });
  return (
    <form
      className="admin-action-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
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
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(isSubmitting) => (
          <DialogFormActions
            isPending={isSubmitting || update.isPending}
            onClose={onClose}
            submitLabel={t("actions.update")}
          />
        )}
      </form.Subscribe>
    </form>
  );
}

function DialogFormActions({
  isPending,
  onClose,
  submitLabel,
}: {
  isPending: boolean;
  onClose: () => void;
  submitLabel: string;
}) {
  const { t } = useTranslation("admin");
  return (
    <div className="admin-dialog-footer">
      <button className="button secondary" onClick={onClose} type="button">
        {t("actions.cancel")}
      </button>
      <button className="button primary" disabled={isPending} type="submit">
        {submitLabel}
      </button>
    </div>
  );
}

function ManagePanel({
  onClose,
  row,
  resource,
  permissions,
}: {
  onClose: () => void;
  row: AdminTableRow;
  resource: AdminResourceKey;
  permissions: readonly PermissionKey[];
}) {
  switch (resource) {
    case "users":
      return canAdminWrite("users", permissions) ? (
        <ManageUserPanel onClose={onClose} row={row} />
      ) : null;
    case "roles":
      return canAdminWrite("roles", permissions) ? (
        <ManageRolePanel onClose={onClose} row={row} />
      ) : null;
    case "domains":
      return canAdminWrite("domains", permissions) ? (
        <ManageDomainPanel onClose={onClose} row={row} />
      ) : null;
    case "provider-connections":
      return canAdminWrite("provider-connections", permissions) ? (
        <ManageProviderPanel onClose={onClose} row={row} />
      ) : null;
    default:
      return null;
  }
}

function ViewRecord({ row }: { row: AdminTableRow }) {
  const { t } = useTranslation("admin");
  const entries = columnKeys
    .filter((key) => row[key] !== undefined)
    .map((key) => [key, row[key]] as const);
  return (
    <dl className="record-details">
      {entries.map(([key, raw]) => (
        <div key={key}>
          <dt>{t(`columns.${key}`)}</dt>
          <dd>
            {raw === null || raw === "" ? (
              t("values.empty")
            ) : typeof raw === "boolean" ? (
              t(raw ? "values.true" : "values.false")
            ) : typeof raw === "string" && localizedValues.has(raw) ? (
              t(`values.${raw}`)
            ) : (
              <BidiText kind="identifier">{String(raw)}</BidiText>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function recordLabel(row: AdminTableRow): string {
  return (
    textCell(row, "email") ||
    textCell(row, "name") ||
    textCell(row, "label") ||
    textCell(row, "event_type") ||
    textCell(row, "id")
  );
}

function DeleteRecordPanel({
  onClose,
  resource,
  row,
}: {
  onClose: () => void;
  resource: AdminResourceKey;
  row: AdminTableRow;
}) {
  const { t } = useTranslation("admin");
  const client = useQueryClient();
  const remove = useMutation(adminMutationOptions(client).delete);
  const id = textCell(row, "id");
  const submit = async () => {
    switch (resource) {
      case "users":
        await remove.mutateAsync({ resource, id });
        break;
      case "roles":
        await remove.mutateAsync({ resource, id });
        break;
      case "domains":
        await remove.mutateAsync({ resource, id });
        break;
      case "webhook-events":
        await remove.mutateAsync({ resource, id });
        break;
      default:
        return;
    }
    onClose();
  };
  return (
    <div className="delete-confirmation">
      <p>{t("dialog.deleteWarning")}</p>
      <strong>
        <BidiText kind="identifier">{recordLabel(row)}</BidiText>
      </strong>
      {remove.error ? <ErrorState error={remove.error} /> : null}
      <div className="admin-dialog-footer">
        <button className="button secondary" onClick={onClose} type="button">
          {t("actions.cancel")}
        </button>
        <button
          className="button danger"
          disabled={remove.isPending}
          onClick={() => void submit()}
          type="button"
        >
          <Trash2 aria-hidden="true" />
          {t("actions.confirmDelete")}
        </button>
      </div>
    </div>
  );
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
        noValidate
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
          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(isSubmitting) => (
              <button
                className="button primary"
                disabled={isSubmitting || save.isPending || !domainId}
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
        noValidate
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
          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(isSubmitting) => (
              <button
                className="button primary"
                disabled={isSubmitting || save.isPending}
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

function canWriteAdminResource(
  resource: AdminResourceKey,
  permissions: readonly PermissionKey[],
): boolean {
  switch (resource) {
    case "users":
      return canAdminWrite("users", permissions);
    case "roles":
      return canAdminWrite("roles", permissions);
    case "domains":
      return canAdminWrite("domains", permissions);
    case "provider-connections":
      return canAdminWrite("provider-connections", permissions);
    case "webhook-events":
      return canAdminWrite("webhook-events", permissions);
    default:
      return false;
  }
}

export function AdminPage({ resource }: { resource: AdminResourceKey }) {
  const { t } = useTranslation("admin");
  const client = useQueryClient();
  const [auditSearch, setAuditSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedAction, setSelectedAction] =
    useState<SelectedAdminAction | null>(null);
  const query = useQuery(adminQueryOptions(resource, auditSearch));
  const sync = useMutation(providerSyncMutationOptions(client));
  const session = useQuery(sessionQueryOptions());
  const permissions = session.data?.permissions ?? [];
  const canWriteRows = canWriteAdminResource(resource, permissions);
  const canCreate = creatableResources.has(resource) && canWriteRows;
  const data = query.data;
  const domains =
    resource === "signatures" && Array.isArray(data)
      ? data.filter(isDomain)
      : [];
  const settings =
    resource === "settings" && isSettings(data) ? data : undefined;
  useEffect(() => {
    setCreateOpen(false);
    setSelectedAction(null);
  }, [resource]);
  const canManageSettings =
    resource === "settings" && canAdminWrite("settings", permissions);
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
            <div className="surface-actions">
              <small>{t("audited")}</small>
              {canCreate ? (
                <button
                  className="button primary"
                  onClick={() => setCreateOpen(true)}
                  type="button"
                >
                  <Plus aria-hidden="true" />
                  {t("actions.add", {
                    resource: t(`navigation.${resource}`),
                  })}
                </button>
              ) : null}
            </div>
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
              <DataTable
                canWrite={canWriteRows}
                data={data}
                onAction={setSelectedAction}
                resource={resource}
              />
              {resource === "signatures" ? (
                <SignatureEditor
                  canSave={canAdminWrite("signatures", permissions)}
                  domains={domains}
                />
              ) : null}
              {settings ? (
                <SettingsEditor
                  canSave={canManageSettings}
                  settings={settings}
                />
              ) : null}
              {settings && canManageSettings ? (
                <section className="admin-runtime-settings">
                  <header>
                    <h2>{t("runtime.heading")}</h2>
                    <p>{t("runtime.description")}</p>
                  </header>
                  <Suspense fallback={<LoadingState />}>
                    <CloudflareSettings />
                    <StorageSettings />
                  </Suspense>
                </section>
              ) : null}
            </>
          )}
        </section>
        {createOpen ? (
          <AdminDialog
            onClose={() => setCreateOpen(false)}
            title={t("dialog.createTitle", {
              resource: t(`navigation.${resource}`),
            })}
          >
            <CreatePanel
              onClose={() => setCreateOpen(false)}
              permissions={permissions}
              resource={resource}
            />
          </AdminDialog>
        ) : null}
        {selectedAction?.type === "view" ? (
          <AdminDialog
            onClose={() => setSelectedAction(null)}
            title={t("dialog.viewTitle", {
              resource: t(`navigation.${resource}`),
            })}
          >
            <ViewRecord row={selectedAction.row} />
            <div className="admin-dialog-footer">
              <button
                className="button primary"
                onClick={() => setSelectedAction(null)}
                type="button"
              >
                {t("actions.close")}
              </button>
            </div>
          </AdminDialog>
        ) : null}
        {selectedAction?.type === "edit" ? (
          <AdminDialog
            onClose={() => setSelectedAction(null)}
            title={t("dialog.editTitle", {
              resource: t(`navigation.${resource}`),
            })}
          >
            <ManagePanel
              onClose={() => setSelectedAction(null)}
              permissions={permissions}
              resource={resource}
              row={selectedAction.row}
            />
          </AdminDialog>
        ) : null}
        {selectedAction?.type === "delete" ? (
          <AdminDialog
            onClose={() => setSelectedAction(null)}
            title={t("dialog.deleteTitle", {
              resource: t(`navigation.${resource}`),
            })}
            tone="danger"
          >
            <DeleteRecordPanel
              onClose={() => setSelectedAction(null)}
              resource={resource}
              row={selectedAction.row}
            />
          </AdminDialog>
        ) : null}
      </main>
    </div>
  );
}
