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
import { useForm } from "react-hook-form";
import { apiRequest, jsonBody } from "../../lib/api";
import { ErrorState, LoadingState, SuccessNote } from "../../components/Status";

type AdminResource =
  | "users"
  | "roles"
  | "domains"
  | "signatures"
  | "settings"
  | "provider-connections"
  | "webhook-events"
  | "audit-events"
  | "analytics";

const adminNav = [
  ["users", "Users", Users],
  ["roles", "Roles & access", Shield],
  ["domains", "Domains", Globe2],
  ["signatures", "Signatures", ScrollText],
  ["settings", "System settings", Settings2],
  ["provider-connections", "Providers", Cable],
  ["webhook-events", "Webhook events", Webhook],
  ["audit-events", "Audit trail", KeyRound],
  ["analytics", "Analytics", Activity],
] as const;

const endpoint: Record<AdminResource, string> = {
  users: "/admin/users",
  roles: "/admin/roles",
  domains: "/admin/domains",
  signatures: "/admin/domains",
  settings: "/admin/settings",
  "provider-connections": "/admin/provider-connections",
  "webhook-events": "/admin/webhook-events",
  "audit-events": "/admin/audit-events",
  analytics: "/admin/analytics",
};

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function DataTable({ data }: { data: unknown }) {
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  const columns = [
    ...new Set(
      rows.flatMap((row) =>
        typeof row === "object" && row
          ? Object.keys(row as Record<string, unknown>)
          : [],
      ),
    ),
  ].slice(0, 8);
  if (!rows.length) {
    return (
      <div className="empty-admin">
        <strong>No records yet</strong>
        <p>The first record created here will appear in this table.</p>
      </div>
    );
  }
  return (
    <div className="data-table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column.replaceAll("_", " ")}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={String((row as { id?: unknown }).id ?? index)}>
              {columns.map((column) => (
                <td key={column}>
                  {displayValue((row as Record<string, unknown>)[column])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CreatePanel({ resource }: { resource: AdminResource }) {
  const client = useQueryClient();
  const form = useForm<Record<string, string>>();
  const create = useMutation({
    mutationFn: (values: Record<string, string>) => {
      const headers = { "idempotency-key": crypto.randomUUID() };
      if (resource === "users") {
        return apiRequest("/admin/users", {
          method: "POST",
          headers,
          body: jsonBody({
            email: values.email,
            displayName: values.displayName,
            password: values.password,
            roleIds: (values.roleIds ?? "")
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean),
          }),
        });
      }
      if (resource === "domains") {
        return apiRequest("/admin/domains", {
          method: "POST",
          headers,
          body: jsonBody({ name: values.name }),
        });
      }
      if (resource === "roles") {
        return apiRequest("/admin/roles", {
          method: "POST",
          headers,
          body: jsonBody({
            name: values.name,
            description: values.description ?? "",
            permissions: (values.permissions ?? "")
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean),
          }),
        });
      }
      return apiRequest("/admin/provider-connections", {
        method: "POST",
        headers,
        body: jsonBody({
          providerKey: "brevo",
          label: values.label,
          apiKey: values.apiKey,
          webhookSecret: values.webhookSecret,
        }),
      });
    },
    onSuccess: async () => {
      form.reset();
      await client.invalidateQueries({ queryKey: ["admin", resource] });
    },
  });
  if (
    !["users", "domains", "roles", "provider-connections"].includes(resource)
  ) {
    return null;
  }
  const fields: Record<string, Array<[string, string, string?]>> = {
    users: [
      ["displayName", "Display name"],
      ["email", "Email address", "email"],
      ["password", "Temporary password", "password"],
      ["roleIds", "Role IDs (comma-separated)"],
    ],
    domains: [["name", "Domain name"]],
    roles: [
      ["name", "Role name"],
      ["description", "Description"],
      ["permissions", "Permission keys (comma-separated)"],
    ],
    "provider-connections": [
      ["label", "Connection label"],
      ["apiKey", "Brevo API key", "password"],
      ["webhookSecret", "Webhook secret", "password"],
    ],
  };
  return (
    <details className="create-panel">
      <summary>Add {resource.replaceAll("-", " ")}</summary>
      <form onSubmit={form.handleSubmit((values) => create.mutate(values))}>
        {fields[resource].map(([name, label, type]) => (
          <label className="field" key={name}>
            <span>{label}</span>
            <input
              {...form.register(name, { required: true })}
              type={type ?? "text"}
            />
          </label>
        ))}
        {create.error ? <ErrorState error={create.error} /> : null}
        <button className="button primary" disabled={create.isPending}>
          Create
        </button>
      </form>
    </details>
  );
}

function ManagePanel({ resource }: { resource: AdminResource }) {
  const client = useQueryClient();
  const form = useForm<Record<string, string>>({
    defaultValues: { action: "update" },
  });
  const supported = [
    "users",
    "roles",
    "domains",
    "provider-connections",
    "webhook-events",
  ].includes(resource);
  const mutate = useMutation({
    mutationFn: (values: Record<string, string>) => {
      const base: Record<string, string> = {
        users: "/admin/users",
        roles: "/admin/roles",
        domains: "/admin/domains",
        "provider-connections": "/admin/provider-connections",
        "webhook-events": "/admin/webhook-events",
      };
      const deleting =
        values.action === "delete" || resource === "webhook-events";
      let body: Record<string, unknown> | undefined;
      if (!deleting && resource === "users") {
        body = {
          ...(values.displayName ? { displayName: values.displayName } : {}),
          ...(values.status ? { status: values.status } : {}),
          ...(values.roleIds
            ? {
                roleIds: values.roleIds
                  .split(",")
                  .map((value) => value.trim())
                  .filter(Boolean),
              }
            : {}),
        };
      } else if (!deleting && resource === "roles") {
        body = {
          description: values.description ?? "",
          permissions: (values.permissions ?? "")
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
        };
      } else if (!deleting && resource === "domains") {
        body = {
          ...(values.status ? { status: values.status } : {}),
          ...(values.outboundConnectionId
            ? { outboundConnectionId: values.outboundConnectionId }
            : {}),
        };
      } else if (!deleting && resource === "provider-connections") {
        body = {
          ...(values.status ? { status: values.status } : {}),
          ...(values.apiKey ? { apiKey: values.apiKey } : {}),
          ...(values.webhookSecret
            ? { webhookSecret: values.webhookSecret }
            : {}),
        };
      }
      return apiRequest(`${base[resource]}/${values.id}`, {
        method: deleting ? "DELETE" : "PATCH",
        headers: { "idempotency-key": crypto.randomUUID() },
        ...(body ? { body: jsonBody(body) } : {}),
      });
    },
    onSuccess: async () => {
      form.reset({ action: "update" });
      await client.invalidateQueries({ queryKey: ["admin", resource] });
    },
  });
  if (!supported) return null;
  return (
    <details className="create-panel">
      <summary>Manage existing {resource.replaceAll("-", " ")}</summary>
      <form onSubmit={form.handleSubmit((values) => mutate.mutate(values))}>
        <label className="field">
          <span>Record ID</span>
          <input {...form.register("id", { required: true })} />
        </label>
        {resource !== "provider-connections" &&
        resource !== "webhook-events" ? (
          <label className="field">
            <span>Action</span>
            <select {...form.register("action")}>
              <option value="update">Update</option>
              <option value="delete">Delete</option>
            </select>
          </label>
        ) : null}
        {resource === "users" ? (
          <>
            <label className="field">
              <span>Display name</span>
              <input {...form.register("displayName")} />
            </label>
            <label className="field">
              <span>Status</span>
              <select {...form.register("status")}>
                <option value="">Unchanged</option>
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
              </select>
            </label>
            <label className="field">
              <span>Role IDs</span>
              <input {...form.register("roleIds")} />
            </label>
          </>
        ) : null}
        {resource === "roles" ? (
          <>
            <label className="field">
              <span>Description</span>
              <input {...form.register("description")} />
            </label>
            <label className="field">
              <span>Permission keys</span>
              <input {...form.register("permissions")} />
            </label>
          </>
        ) : null}
        {resource === "domains" ? (
          <>
            <label className="field">
              <span>Status</span>
              <select {...form.register("status")}>
                <option value="">Unchanged</option>
                <option value="active">Active</option>
                <option value="disabled">Disabled</option>
              </select>
            </label>
            <label className="field">
              <span>Outbound connection ID</span>
              <input {...form.register("outboundConnectionId")} />
            </label>
          </>
        ) : null}
        {resource === "provider-connections" ? (
          <>
            <label className="field">
              <span>Status</span>
              <select {...form.register("status")}>
                <option value="">Unchanged</option>
                <option value="active">Active</option>
                <option value="disabled">Disabled</option>
              </select>
            </label>
            <label className="field">
              <span>New API key</span>
              <input {...form.register("apiKey")} type="password" />
            </label>
            <label className="field">
              <span>New webhook secret</span>
              <input {...form.register("webhookSecret")} type="password" />
            </label>
          </>
        ) : null}
        {mutate.error ? <ErrorState error={mutate.error} /> : null}
        <button
          className={`button ${
            form.watch("action") === "delete" || resource === "webhook-events"
              ? "danger"
              : "primary"
          }`}
          disabled={mutate.isPending}
        >
          {resource === "webhook-events"
            ? "Delete webhook event"
            : "Apply change"}
        </button>
      </form>
    </details>
  );
}

function SignatureEditor({
  domains,
}: {
  domains: Array<{ id: string; name: string }>;
}) {
  const client = useQueryClient();
  const [domainId, setDomainId] = useState("");
  const form = useForm<{ html: string; text: string; enabled: boolean }>({
    defaultValues: { html: "", text: "", enabled: false },
  });
  useEffect(() => {
    if (!domainId && domains[0]) setDomainId(domains[0].id);
  }, [domainId, domains]);
  const signature = useQuery({
    queryKey: ["admin", "signature", domainId],
    queryFn: () =>
      apiRequest<{
        html_content: string;
        text_content: string;
        is_enabled: number;
      }>(`/admin/domains/${domainId}/signature`),
    enabled: Boolean(domainId),
  });
  useEffect(() => {
    if (!signature.data) return;
    form.reset({
      html: signature.data.html_content,
      text: signature.data.text_content,
      enabled: Boolean(signature.data.is_enabled),
    });
  }, [form, signature.data]);
  const save = useMutation({
    mutationFn: (values: { html: string; text: string; enabled: boolean }) =>
      apiRequest(`/admin/domains/${domainId}/signature`, {
        method: "PUT",
        headers: { "idempotency-key": crypto.randomUUID() },
        body: jsonBody(values),
      }),
    onSuccess: () =>
      client.invalidateQueries({
        queryKey: ["admin", "signature", domainId],
      }),
  });
  return (
    <section className="admin-editor">
      <h2>Domain signature editor</h2>
      <form onSubmit={form.handleSubmit((values) => save.mutate(values))}>
        <label className="field">
          <span>Domain</span>
          <select
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
        <label className="field">
          <span>Plain-text signature</span>
          <textarea {...form.register("text")} rows={5} />
        </label>
        <label className="field">
          <span>HTML signature</span>
          <textarea {...form.register("html")} rows={8} />
        </label>
        <label className="check-field">
          <input {...form.register("enabled")} type="checkbox" />
          Apply this signature to outbound mail
        </label>
        {save.error ? <ErrorState error={save.error} /> : null}
        {save.isSuccess ? <SuccessNote>Signature saved.</SuccessNote> : null}
        <button className="button primary" disabled={save.isPending}>
          Save signature
        </button>
      </form>
    </section>
  );
}

interface SettingsForm {
  site_title: string;
  registration_enabled: boolean;
  invite_required: boolean;
  inbound_enabled: boolean;
  outbound_enabled: boolean;
  unknown_recipient_policy: "reject" | "store";
  max_mailboxes_per_user: number;
  max_attachments_per_message: number;
  max_attachment_bytes: number;
}

function SettingsEditor({ settings }: { settings: Record<string, unknown> }) {
  const client = useQueryClient();
  const form = useForm<SettingsForm>();
  useEffect(() => {
    form.reset({
      site_title: String(settings.site_title ?? "UniMailbox"),
      registration_enabled: Boolean(settings.registration_enabled),
      invite_required: Boolean(settings.invite_required),
      inbound_enabled: Boolean(settings.inbound_enabled),
      outbound_enabled: Boolean(settings.outbound_enabled),
      unknown_recipient_policy:
        settings.unknown_recipient_policy === "store" ? "store" : "reject",
      max_mailboxes_per_user: Number(settings.max_mailboxes_per_user ?? 10),
      max_attachments_per_message: Number(
        settings.max_attachments_per_message ?? 20,
      ),
      max_attachment_bytes: Number(settings.max_attachment_bytes ?? 26_214_400),
    });
  }, [form, settings]);
  const save = useMutation({
    mutationFn: (values: SettingsForm) =>
      apiRequest("/admin/settings", {
        method: "PATCH",
        headers: { "idempotency-key": crypto.randomUUID() },
        body: jsonBody({
          ...values,
          registration_enabled: Number(values.registration_enabled),
          invite_required: Number(values.invite_required),
          inbound_enabled: Number(values.inbound_enabled),
          outbound_enabled: Number(values.outbound_enabled),
        }),
      }),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ["admin", "settings"] }),
  });
  return (
    <section className="admin-editor">
      <h2>Runtime policy</h2>
      <form onSubmit={form.handleSubmit((values) => save.mutate(values))}>
        <label className="field">
          <span>Site title</span>
          <input {...form.register("site_title", { required: true })} />
        </label>
        <label className="field">
          <span>Unknown recipient policy</span>
          <select {...form.register("unknown_recipient_policy")}>
            <option value="reject">Reject</option>
            <option value="store">Store without mailbox delivery</option>
          </select>
        </label>
        <div className="settings-number-grid">
          <label className="field">
            <span>Mailboxes per user</span>
            <input
              {...form.register("max_mailboxes_per_user", {
                valueAsNumber: true,
              })}
              min="1"
              type="number"
            />
          </label>
          <label className="field">
            <span>Attachments per message</span>
            <input
              {...form.register("max_attachments_per_message", {
                valueAsNumber: true,
              })}
              min="1"
              type="number"
            />
          </label>
          <label className="field">
            <span>Attachment bytes</span>
            <input
              {...form.register("max_attachment_bytes", {
                valueAsNumber: true,
              })}
              min="1"
              type="number"
            />
          </label>
        </div>
        <div className="settings-check-grid">
          {(
            [
              ["registration_enabled", "Public registration"],
              ["invite_required", "Require invite"],
              ["inbound_enabled", "Inbound mail"],
              ["outbound_enabled", "Outbound mail"],
            ] as const
          ).map(([name, label]) => (
            <label className="check-field" key={name}>
              <input {...form.register(name)} type="checkbox" />
              {label}
            </label>
          ))}
        </div>
        {save.error ? <ErrorState error={save.error} /> : null}
        {save.isSuccess ? (
          <SuccessNote>Runtime policy saved.</SuccessNote>
        ) : null}
        <button className="button primary" disabled={save.isPending}>
          Save settings
        </button>
      </form>
    </section>
  );
}

export function AdminPage({ resource }: { resource: AdminResource }) {
  const client = useQueryClient();
  const [auditQuery, setAuditQuery] = useState("");
  const current = adminNav.find(([id]) => id === resource) ?? adminNav[0];
  const query = useQuery({
    queryKey: ["admin", resource, auditQuery],
    queryFn: () =>
      apiRequest<unknown>(
        resource === "audit-events" && auditQuery.trim()
          ? `${endpoint[resource]}?q=${encodeURIComponent(auditQuery.trim())}`
          : endpoint[resource],
      ),
  });
  const sync = useMutation({
    mutationFn: () =>
      apiRequest("/admin/providers/sync", {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
      }),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ["admin", resource] }),
  });
  return (
    <div className="admin-app">
      <aside className="admin-sidebar">
        <Link className="wordmark compact" to="/inbox">
          <span>CM</span> UniMailbox
        </Link>
        <div className="admin-rail-title">Control plane</div>
        <nav>
          {adminNav.map(([id, label, Icon]) => (
            <Link
              aria-current={id === resource ? "page" : undefined}
              className={id === resource ? "active" : ""}
              key={id}
              to={`/admin/${id}`}
            >
              <Icon />
              {label}
            </Link>
          ))}
        </nav>
        <Link className="back-link" to="/inbox">
          <ArrowLeft /> Back to mail
        </Link>
      </aside>
      <main className="admin-main">
        <header>
          <div>
            <div className="section-kicker">Administration</div>
            <h1>{current[1]}</h1>
          </div>
          {resource === "provider-connections" ? (
            <button
              className="button secondary"
              disabled={sync.isPending}
              onClick={() => sync.mutate()}
            >
              <RefreshCw className={sync.isPending ? "spin" : ""} />
              Reconcile now
            </button>
          ) : null}
        </header>
        <section className="admin-surface">
          <div className="surface-heading">
            <div>
              <span className="status-pill">LIVE</span>
              <strong>{current[1]} registry</strong>
            </div>
            <small>Changes are audited by the Worker</small>
          </div>
          {resource === "audit-events" ? (
            <label className="admin-search">
              <span>Search audit action, resource, or request ID</span>
              <input
                onChange={(event) => setAuditQuery(event.target.value)}
                placeholder="installation, mailbox, request ID…"
                value={auditQuery}
              />
            </label>
          ) : null}
          {sync.isSuccess ? (
            <SuccessNote>Provider reconciliation complete.</SuccessNote>
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
              <DataTable data={query.data} />
              {resource === "signatures" ? (
                <SignatureEditor
                  domains={
                    (query.data as Array<{ id: string; name: string }>) ?? []
                  }
                />
              ) : null}
              {resource === "settings" && query.data ? (
                <SettingsEditor
                  settings={query.data as Record<string, unknown>}
                />
              ) : null}
            </>
          )}
        </section>
        <CreatePanel resource={resource} />
        <ManagePanel resource={resource} />
      </main>
    </div>
  );
}
