import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  KeyRound,
  MailPlus,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { apiRequest, jsonBody } from "../../lib/api";
import { Link } from "../../lib/navigation";
import { ErrorState, LoadingState, SuccessNote } from "../../components/Status";

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
  section: "account" | "mailboxes";
}) {
  const client = useQueryClient();
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
  const password = useMutation({
    mutationFn: (values: { currentPassword: string; newPassword: string }) =>
      apiRequest("/auth/password/reset", {
        method: "POST",
        body: jsonBody(values),
      }),
    onSuccess: () => passwordForm.reset(),
  });
  const repair = useMutation({
    mutationFn: () =>
      apiRequest<{ csrfToken: string }>("/setup/repair", {
        method: "POST",
      }),
    onSuccess: (session) => {
      window.sessionStorage.setItem("unimailbox.setup-csrf", session.csrfToken);
      window.location.assign("/setup");
    },
  });
  const revokeCloudflare = useMutation({
    mutationFn: () =>
      apiRequest<{ revoked: boolean }>("/setup/cloudflare/oauth/revoke", {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
      }),
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
          <h1>{section === "account" ? "Security" : "Mailboxes"}</h1>
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
      </nav>
      {section === "account" ? (
        <section className="settings-card">
          <ShieldCheck />
          <div>
            <h2>Change password</h2>
            <p>
              Changing your password immediately revokes every active session.
            </p>
            <form
              className="form-stack narrow"
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
                  type="password"
                />
              </label>
              {password.error ? <ErrorState error={password.error} /> : null}
              {password.isSuccess ? (
                <SuccessNote>Password changed; sessions revoked.</SuccessNote>
              ) : null}
              <button className="button primary">Update password</button>
            </form>
            <div className="repair-box">
              <Wrench />
              <div>
                <strong>Installation repair mode</strong>
                <p>
                  Administrators can reopen setup checks for 15 minutes. Every
                  repair action is audited.
                </p>
              </div>
              <button
                className="button secondary"
                disabled={repair.isPending}
                onClick={() => repair.mutate()}
                type="button"
              >
                Open repair mode
              </button>
            </div>
            <div className="repair-box">
              <ShieldCheck />
              <div>
                <strong>Cloudflare OAuth authorization</strong>
                <p>
                  Revoke the optional Cloudflare authorization and remove its
                  encrypted token from this installation.
                </p>
                {revokeCloudflare.isSuccess ? (
                  <small>
                    {revokeCloudflare.data.revoked
                      ? "Authorization revoked."
                      : "No OAuth authorization was connected."}
                  </small>
                ) : null}
              </div>
              <button
                className="button secondary"
                disabled={revokeCloudflare.isPending}
                onClick={() => revokeCloudflare.mutate()}
                type="button"
              >
                Revoke OAuth
              </button>
            </div>
          </div>
        </section>
      ) : (
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
      )}
    </main>
  );
}
