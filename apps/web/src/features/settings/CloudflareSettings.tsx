import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  CheckCircle2,
  Cloud,
  MailCheck,
  RadioTower,
  Send,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { ErrorState, LoadingState, SuccessNote } from "../../components/Status";
import { apiRequest, jsonBody } from "../../lib/api";

interface ConfigurationCheckpoint {
  checkpointKey: string;
  status: "pending" | "configured" | "verified" | "failed";
  metadata: Record<string, unknown>;
  errorCode: string | null;
  errorMessage: string | null;
  verifiedAt: string | null;
}

function adminPost<T>(path: string, body?: unknown): Promise<T> {
  return apiRequest<T>(path, {
    method: "POST",
    headers: { "idempotency-key": crypto.randomUUID() },
    ...(body === undefined ? {} : { body: jsonBody(body) }),
  });
}

function CheckpointStatus({
  checkpoint,
}: {
  checkpoint?: ConfigurationCheckpoint;
}) {
  const status = checkpoint?.status ?? "pending";
  return (
    <span className={`checkpoint-status ${status}`}>
      <span aria-hidden="true" />
      {status === "verified"
        ? "Verified"
        : status === "configured"
          ? "Connected"
          : status === "failed"
            ? "Action required"
            : "Not configured"}
    </span>
  );
}

export function CloudflareSettings() {
  const client = useQueryClient();
  const [inboundToken, setInboundToken] = useState<string>();
  const verifyForm = useForm<{
    accountId: string;
    zoneId: string;
    mode: "dashboard" | "oauth";
  }>({ defaultValues: { mode: "dashboard" } });
  const domainForm = useForm<{ name: string }>();
  const brevoForm = useForm<{
    label: string;
    apiKey: string;
    webhookSecret: string;
    domainId: string;
  }>({ defaultValues: { label: "Primary Brevo" } });
  const outboundForm = useForm<{
    connectionId: string;
    from: string;
    to: string;
  }>();
  const checkpoints = useQuery({
    queryKey: ["cloudflare-settings"],
    queryFn: () =>
      apiRequest<ConfigurationCheckpoint[]>("/admin/cloudflare/status"),
  });
  const refresh = () =>
    client.invalidateQueries({ queryKey: ["cloudflare-settings"] });
  const checkpoint = (key: string) =>
    checkpoints.data?.find((item) => item.checkpointKey === key);

  const oauth = useMutation({
    mutationFn: () =>
      adminPost<{ url: string }>("/admin/cloudflare/oauth/start"),
    onSuccess: ({ url }) => window.location.assign(url),
  });
  const revoke = useMutation({
    mutationFn: () =>
      adminPost<{ revoked: boolean }>("/admin/cloudflare/oauth/revoke"),
    onSuccess: refresh,
  });
  const verify = useMutation({
    mutationFn: (values: {
      accountId: string;
      zoneId: string;
      mode: "dashboard" | "oauth";
    }) => adminPost("/admin/cloudflare/verify", values),
    onSuccess: refresh,
  });
  const domain = useMutation({
    mutationFn: (values: { name: string }) =>
      adminPost<{ id: string; name: string }>(
        "/admin/cloudflare/domains",
        values,
      ),
    onSuccess: async () => {
      domainForm.reset();
      await refresh();
    },
  });
  const inbound = useMutation({
    mutationFn: () =>
      adminPost<{
        status: "awaiting_message" | "received";
        recipient?: string;
        subject?: string;
        token?: string;
      }>("/admin/cloudflare/smoke-test/inbound", {
        ...(inboundToken ? { token: inboundToken } : {}),
      }),
    onSuccess: async (result) => {
      setInboundToken(
        result.status === "awaiting_message" ? result.token : undefined,
      );
      await refresh();
    },
  });
  const brevo = useMutation({
    mutationFn: (values: {
      label: string;
      apiKey: string;
      webhookSecret: string;
      domainId: string;
    }) =>
      adminPost<{ connectionId: string }>("/admin/cloudflare/brevo", {
        ...values,
        providerKey: "brevo",
      }),
    onSuccess: async () => {
      brevoForm.reset({ label: "Primary Brevo" });
      await refresh();
    },
  });
  const outbound = useMutation({
    mutationFn: (values: { connectionId: string; from: string; to: string }) =>
      adminPost("/admin/cloudflare/smoke-test/outbound", values),
    onSuccess: refresh,
  });

  if (checkpoints.isLoading) {
    return <LoadingState label="Loading Cloudflare configuration" />;
  }
  if (checkpoints.error) {
    return (
      <ErrorState
        error={checkpoints.error}
        retry={() => void checkpoints.refetch()}
      />
    );
  }

  return (
    <div className="configuration-stack">
      <section className="settings-card configuration-hero">
        <Cloud />
        <div>
          <div className="card-heading">
            <div>
              <span className="card-index">01 / Cloudflare account</span>
              <h2>Connect the control plane</h2>
            </div>
            <CheckpointStatus checkpoint={checkpoint("cloudflare_mail")} />
          </div>
          <p>
            OAuth is optional. Dashboard-assisted mode only records your account
            and zone IDs, then gives you exact links for Email Routing and DNS.
          </p>
          <div className="button-row">
            <button
              className="button primary"
              disabled={oauth.isPending}
              onClick={() => oauth.mutate()}
              type="button"
            >
              <Cloud /> Connect with OAuth
            </button>
            <button
              className="button secondary"
              disabled={revoke.isPending}
              onClick={() => revoke.mutate()}
              type="button"
            >
              Revoke OAuth
            </button>
          </div>
          {oauth.error ? <ErrorState error={oauth.error} /> : null}
          {revoke.error ? <ErrorState error={revoke.error} /> : null}
          {revoke.isSuccess ? (
            <SuccessNote>
              {revoke.data.revoked
                ? "Cloudflare authorization removed."
                : "No OAuth authorization was connected."}
            </SuccessNote>
          ) : null}
          <form
            className="configuration-form three-column"
            onSubmit={verifyForm.handleSubmit((values) =>
              verify.mutate(values),
            )}
          >
            <label className="field">
              <span>Cloudflare account ID</span>
              <input
                {...verifyForm.register("accountId", { required: true })}
                autoComplete="off"
              />
            </label>
            <label className="field">
              <span>Zone ID</span>
              <input
                {...verifyForm.register("zoneId", { required: true })}
                autoComplete="off"
              />
            </label>
            <label className="field">
              <span>Connection mode</span>
              <select {...verifyForm.register("mode")}>
                <option value="dashboard">Dashboard assisted</option>
                <option value="oauth">OAuth connected</option>
              </select>
            </label>
            <button className="button secondary" disabled={verify.isPending}>
              <ShieldCheck /> Save and verify
            </button>
          </form>
          {verify.error ? <ErrorState error={verify.error} /> : null}
        </div>
      </section>

      <div className="configuration-grid">
        <section className="settings-card vertical">
          <div className="card-heading">
            <div>
              <span className="card-index">02 / Domain</span>
              <h2>Email Routing domain</h2>
            </div>
            <RadioTower />
          </div>
          <p>
            Add the domain that receives mail. With OAuth, UniMailbox verifies
            the zone and prepares its Email Routing catch-all.
          </p>
          <form
            className="form-stack"
            onSubmit={domainForm.handleSubmit((values) =>
              domain.mutate(values),
            )}
          >
            <label className="field">
              <span>Managed domain</span>
              <input
                {...domainForm.register("name", { required: true })}
                placeholder="mail.example.com"
              />
            </label>
            <button className="button primary" disabled={domain.isPending}>
              Add domain
            </button>
          </form>
          {domain.error ? <ErrorState error={domain.error} /> : null}
          {domain.isSuccess ? (
            <SuccessNote>{domain.data.name} is ready.</SuccessNote>
          ) : null}
        </section>

        <section className="settings-card vertical">
          <div className="card-heading">
            <div>
              <span className="card-index">03 / Incoming mail</span>
              <h2>Inbound smoke test</h2>
            </div>
            <CheckpointStatus checkpoint={checkpoint("inbound_smoke_test")} />
          </div>
          <p>
            Generate a one-time subject, send it to the displayed address, then
            verify that the Worker accepted the message.
          </p>
          {inbound.data?.recipient ? (
            <div className="operator-instruction">
              <span>Send to</span>
              <strong>{inbound.data.recipient}</strong>
              <span>Subject</span>
              <code>{inbound.data.subject}</code>
            </div>
          ) : null}
          <button
            className="button secondary"
            disabled={inbound.isPending}
            onClick={() => inbound.mutate()}
            type="button"
          >
            <MailCheck />
            {inboundToken ? "Check for message" : "Start inbound test"}
          </button>
          {inbound.error ? <ErrorState error={inbound.error} /> : null}
        </section>

        <section className="settings-card vertical">
          <div className="card-heading">
            <div>
              <span className="card-index">04 / Outbound provider</span>
              <h2>Connect Brevo</h2>
            </div>
            <CheckpointStatus checkpoint={checkpoint("brevo")} />
          </div>
          <p>
            API credentials are encrypted before storage. The login email is
            never used as a sender or mailbox address.
          </p>
          <form
            className="form-stack"
            onSubmit={brevoForm.handleSubmit((values) => brevo.mutate(values))}
          >
            <label className="field">
              <span>Connection label</span>
              <input {...brevoForm.register("label", { required: true })} />
            </label>
            <label className="field">
              <span>Domain ID</span>
              <input {...brevoForm.register("domainId", { required: true })} />
            </label>
            <label className="field">
              <span>Brevo API key</span>
              <input
                {...brevoForm.register("apiKey", { required: true })}
                autoComplete="off"
                type="password"
              />
            </label>
            <label className="field">
              <span>Webhook secret</span>
              <input
                {...brevoForm.register("webhookSecret", { required: true })}
                autoComplete="new-password"
                type="password"
              />
            </label>
            <button className="button primary" disabled={brevo.isPending}>
              Connect Brevo
            </button>
          </form>
          {brevo.error ? <ErrorState error={brevo.error} /> : null}
          {brevo.isSuccess ? (
            <SuccessNote>
              Connection ID: <code>{brevo.data.connectionId}</code>
            </SuccessNote>
          ) : null}
        </section>

        <section className="settings-card vertical">
          <div className="card-heading">
            <div>
              <span className="card-index">05 / Delivery</span>
              <h2>Outbound smoke test</h2>
            </div>
            <CheckpointStatus checkpoint={checkpoint("outbound_smoke_test")} />
          </div>
          <p>
            Send one operational test message before using the provider for
            normal mailbox traffic.
          </p>
          <form
            className="form-stack"
            onSubmit={outboundForm.handleSubmit((values) =>
              outbound.mutate(values),
            )}
          >
            <label className="field">
              <span>Connection ID</span>
              <input
                {...outboundForm.register("connectionId", { required: true })}
              />
            </label>
            <label className="field">
              <span>From address</span>
              <input
                {...outboundForm.register("from", { required: true })}
                type="email"
              />
            </label>
            <label className="field">
              <span>Destination address</span>
              <input
                {...outboundForm.register("to", { required: true })}
                type="email"
              />
            </label>
            <button className="button primary" disabled={outbound.isPending}>
              <Send /> Send test
            </button>
          </form>
          {outbound.error ? <ErrorState error={outbound.error} /> : null}
          {outbound.isSuccess ? (
            <SuccessNote>Outbound delivery accepted.</SuccessNote>
          ) : null}
        </section>
      </div>

      <a
        className="dashboard-link"
        href="https://dash.cloudflare.com/"
        rel="noreferrer"
        target="_blank"
      >
        Open Cloudflare dashboard <ArrowUpRight />
      </a>
    </div>
  );
}
