import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  Cloud,
  Database,
  KeyRound,
  MailPlus,
  ShieldCheck,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { apiRequest, jsonBody } from "../../lib/api";
import { endSession } from "../../lib/session";
import { ErrorState, LoadingState } from "../../components/Status";
import { CloudflareSettings } from "./CloudflareSettings";
import { StorageSettings } from "./StorageSettings";

interface Mailbox {
  id: string;
  address: string;
  display_name: string;
}

interface MailboxMember {
  user_id: string;
  email: string;
  display_name: string;
  role: "viewer" | "sender" | "admin";
}

function MailboxMembers({ mailboxId }: { mailboxId: string }) {
  const client = useQueryClient();
  const form = useForm<{
    userId: string;
    role: "viewer" | "sender" | "admin";
  }>({ defaultValues: { role: "viewer" } });
  const members = useQuery({
    queryKey: ["mailbox-members", mailboxId],
    queryFn: () =>
      apiRequest<MailboxMember[]>(`/mailboxes/${mailboxId}/members`),
  });
  const add = useMutation({
    mutationFn: (values: {
      userId: string;
      role: "viewer" | "sender" | "admin";
    }) =>
      apiRequest(`/mailboxes/${mailboxId}/members`, {
        method: "POST",
        body: jsonBody(values),
      }),
    onSuccess: async () => {
      form.reset({ userId: "", role: "viewer" });
      await client.invalidateQueries({
        queryKey: ["mailbox-members", mailboxId],
      });
    },
  });
  const update = useMutation({
    mutationFn: (input: {
      userId: string;
      role: "viewer" | "sender" | "admin";
    }) =>
      apiRequest(`/mailboxes/${mailboxId}/members/${input.userId}`, {
        method: "PATCH",
        body: jsonBody({ userId: input.userId, role: input.role }),
      }),
    onSuccess: () =>
      client.invalidateQueries({
        queryKey: ["mailbox-members", mailboxId],
      }),
  });
  const remove = useMutation({
    mutationFn: (userId: string) =>
      apiRequest(`/mailboxes/${mailboxId}/members/${userId}`, {
        method: "DELETE",
      }),
    onSuccess: () =>
      client.invalidateQueries({
        queryKey: ["mailbox-members", mailboxId],
      }),
  });
  return (
    <details className="mailbox-members">
      <summary>Manage sharing</summary>
      {members.isLoading ? (
        <LoadingState label="Loading members" />
      ) : members.error ? (
        <ErrorState error={members.error} />
      ) : (
        <div className="member-list">
          {members.data?.map((member) => (
            <div key={member.user_id}>
              <span>
                <strong>{member.display_name || member.email}</strong>
                <small>{member.email}</small>
              </span>
              <select
                aria-label={`Role for ${member.email}`}
                onChange={(event) =>
                  update.mutate({
                    userId: member.user_id,
                    role: event.target.value as MailboxMember["role"],
                  })
                }
                value={member.role}
              >
                <option value="viewer">Viewer</option>
                <option value="sender">Sender</option>
                <option value="admin">Admin</option>
              </select>
              <button
                className="text-button danger"
                onClick={() => remove.mutate(member.user_id)}
                type="button"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
      <form
        className="member-form"
        onSubmit={form.handleSubmit((values) => add.mutate(values))}
      >
        <input
          {...form.register("userId", { required: true })}
          aria-label="Member user ID"
          placeholder="User ID"
        />
        <select {...form.register("role")} aria-label="Mailbox role">
          <option value="viewer">Viewer</option>
          <option value="sender">Sender</option>
          <option value="admin">Admin</option>
        </select>
        <button className="button secondary" disabled={add.isPending}>
          Share mailbox
        </button>
      </form>
      {add.error ? <ErrorState error={add.error} /> : null}
    </details>
  );
}

export function SettingsPage({
  section,
}: {
  section: "account" | "mailboxes" | "cloudflare" | "storage";
}) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const emailForm = useForm<{
    currentPassword: string;
    email: string;
  }>();
  const passwordForm = useForm<{
    currentPassword: string;
    newPassword: string;
  }>();
  const mailboxForm = useForm<{
    localPart: string;
    domainId: string;
    displayName: string;
  }>();
  const mailboxes = useQuery({
    queryKey: ["mailboxes"],
    queryFn: () => apiRequest<Mailbox[]>("/mailboxes"),
    enabled: section === "mailboxes",
  });
  const requireNewLogin = () => {
    // The Worker revokes every refresh session on an email/password change, so
    // the cached session must go too or the guard would keep this tab "inside".
    endSession(client);
    void navigate({ to: "/login", replace: true });
  };
  const email = useMutation({
    mutationFn: (values: { currentPassword: string; email: string }) =>
      apiRequest("/auth/email", {
        method: "POST",
        body: jsonBody(values),
      }),
    onSuccess: requireNewLogin,
  });
  const password = useMutation({
    mutationFn: (values: { currentPassword: string; newPassword: string }) =>
      apiRequest("/auth/password/reset", {
        method: "POST",
        body: jsonBody(values),
      }),
    onSuccess: requireNewLogin,
  });
  const mailbox = useMutation({
    mutationFn: (values: {
      localPart: string;
      domainId: string;
      displayName: string;
    }) =>
      apiRequest("/mailboxes", {
        method: "POST",
        body: jsonBody(values),
      }),
    onSuccess: async () => {
      mailboxForm.reset();
      await client.invalidateQueries({ queryKey: ["mailboxes"] });
    },
  });
  return (
    <main className="settings-page">
      <header>
        <Link className="icon-button" to="/inbox">
          <ArrowLeft aria-label="Back to mail" />
        </Link>
        <div>
          <div className="section-kicker">Workspace settings</div>
          <h1>
            {section === "account"
              ? "Security"
              : section === "mailboxes"
                ? "Mailboxes"
                : section === "cloudflare"
                  ? "Cloudflare Mail"
                  : "Infrastructure"}
          </h1>
        </div>
      </header>
      <nav className="settings-tabs">
        <Link
          aria-current={section === "account" ? "page" : undefined}
          to="/settings"
        >
          <KeyRound /> Account security
        </Link>
        <Link
          aria-current={section === "mailboxes" ? "page" : undefined}
          to="/settings/mailboxes"
        >
          <MailPlus /> Mailboxes
        </Link>
        <Link
          aria-current={section === "cloudflare" ? "page" : undefined}
          to="/settings/cloudflare"
        >
          <Cloud /> Cloudflare Mail
        </Link>
        <Link
          aria-current={section === "storage" ? "page" : undefined}
          to="/settings/storage"
        >
          <Database /> Storage & runtime
        </Link>
      </nav>
      {section === "account" ? (
        <section className="settings-card">
          <ShieldCheck />
          <div>
            <h2>Login identity</h2>
            <p>
              This email is only your UniMailbox login. It does not create,
              select, or modify a mailbox or sending domain.
            </p>
            <div className="account-security-grid">
              <div>
                <h3>Change login email</h3>
                <form
                  className="form-stack"
                  onSubmit={emailForm.handleSubmit((values) =>
                    email.mutate(values),
                  )}
                >
                  <label className="field">
                    <span>New login email</span>
                    <input
                      {...emailForm.register("email", { required: true })}
                      autoComplete="email"
                      type="email"
                    />
                  </label>
                  <label className="field">
                    <span>Current password</span>
                    <input
                      {...emailForm.register("currentPassword", {
                        required: true,
                        minLength: 12,
                      })}
                      autoComplete="current-password"
                      type="password"
                    />
                  </label>
                  {email.error ? <ErrorState error={email.error} /> : null}
                  <button className="button primary" disabled={email.isPending}>
                    Update login email
                  </button>
                </form>
              </div>
              <div>
                <h3>Change password</h3>
                <form
                  className="form-stack"
                  onSubmit={passwordForm.handleSubmit((values) =>
                    password.mutate(values),
                  )}
                >
                  <label className="field">
                    <span>Current password</span>
                    <input
                      {...passwordForm.register("currentPassword", {
                        required: true,
                        minLength: 12,
                      })}
                      autoComplete="current-password"
                      type="password"
                    />
                  </label>
                  <label className="field">
                    <span>New password</span>
                    <input
                      {...passwordForm.register("newPassword", {
                        required: true,
                        minLength: 12,
                      })}
                      autoComplete="new-password"
                      type="password"
                    />
                  </label>
                  {password.error ? (
                    <ErrorState error={password.error} />
                  ) : null}
                  <button
                    className="button primary"
                    disabled={password.isPending}
                  >
                    Update password
                  </button>
                </form>
              </div>
            </div>
            <div className="session-warning">
              <ShieldCheck />
              Email or password changes revoke every refresh session. You will
              sign in again with the updated credentials.
            </div>
          </div>
        </section>
      ) : section === "mailboxes" ? (
        <div className="settings-grid">
          <section className="settings-card vertical">
            <h2>Your mailboxes</h2>
            {mailboxes.isLoading ? (
              <LoadingState />
            ) : mailboxes.error ? (
              <ErrorState error={mailboxes.error} />
            ) : (
              <div className="simple-list">
                {mailboxes.data?.map((item) => (
                  <div key={item.id}>
                    <strong>{item.display_name || item.address}</strong>
                    <span>{item.address}</span>
                    <MailboxMembers mailboxId={item.id} />
                  </div>
                ))}
              </div>
            )}
          </section>
          <section className="settings-card vertical">
            <h2>Create mailbox</h2>
            <form
              className="form-stack"
              onSubmit={mailboxForm.handleSubmit((values) =>
                mailbox.mutate(values),
              )}
            >
              <label className="field">
                <span>Local part</span>
                <input
                  {...mailboxForm.register("localPart", { required: true })}
                />
              </label>
              <label className="field">
                <span>Domain ID</span>
                <input
                  {...mailboxForm.register("domainId", { required: true })}
                />
              </label>
              <label className="field">
                <span>Display name</span>
                <input {...mailboxForm.register("displayName")} />
              </label>
              {mailbox.error ? <ErrorState error={mailbox.error} /> : null}
              <button className="button primary">Create mailbox</button>
            </form>
          </section>
        </div>
      ) : section === "cloudflare" ? (
        <CloudflareSettings />
      ) : (
        <StorageSettings />
      )}
    </main>
  );
}
