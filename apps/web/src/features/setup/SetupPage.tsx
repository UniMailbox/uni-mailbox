import {
  Check,
  Cloud,
  KeyRound,
  MailCheck,
  RadioTower,
  ServerCog,
  UserRoundCheck,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import {
  InstallationStep,
  type InstallationStatus,
} from "@unimailbox/contracts";
import { apiRequest, jsonBody } from "../../lib/api";
import { navigate } from "../../lib/navigation";
import { ErrorState, LoadingState } from "../../components/Status";

const steps = [
  [InstallationStep.CLAIM, "Claim installation", KeyRound],
  [InstallationStep.PREFLIGHT, "Verify resources", ServerCog],
  [InstallationStep.ADMIN, "Create administrator", UserRoundCheck],
  [InstallationStep.CLOUDFLARE, "Connect Cloudflare", Cloud],
  [InstallationStep.DOMAIN, "Configure domain", RadioTower],
  [InstallationStep.INBOUND_SMOKE_TEST, "Test incoming mail", MailCheck],
  [InstallationStep.BREVO, "Connect Brevo", MailCheck],
  [InstallationStep.OUTBOUND_SMOKE_TEST, "Test outgoing mail", MailCheck],
  [InstallationStep.COMPLETE, "Open workspace", Check],
] as const;

function csrfHeaders(): HeadersInit {
  const csrf = window.sessionStorage.getItem("unimailbox.setup-csrf");
  return csrf ? { "x-setup-csrf": csrf } : {};
}

function SetupAction({ status }: { status: InstallationStatus }) {
  const client = useQueryClient();
  const form = useForm<Record<string, string>>();
  const mutation = useMutation({
    mutationFn: async (values: Record<string, string>) => {
      const common = {
        method: "POST",
        headers: csrfHeaders(),
      };
      switch (status.currentStep) {
        case InstallationStep.CLAIM: {
          const session = await apiRequest<{
            csrfToken: string;
          }>("/setup/claim", {
            method: "POST",
            body: jsonBody({ token: values.token }),
          });
          window.sessionStorage.setItem(
            "unimailbox.setup-csrf",
            session.csrfToken,
          );
          return session;
        }
        case InstallationStep.PREFLIGHT:
          return apiRequest("/setup/preflight", common);
        case InstallationStep.ADMIN:
          return apiRequest("/setup/administrator", {
            ...common,
            body: jsonBody({
              email: values.email,
              password: values.password,
              displayName: values.displayName,
            }),
          });
        case InstallationStep.CLOUDFLARE:
          return apiRequest("/setup/cloudflare/verify", {
            ...common,
            body: jsonBody({
              accountId: values.accountId,
              zoneId: values.zoneId,
              mode:
                new URLSearchParams(window.location.search).get(
                  "cloudflare",
                ) === "connected"
                  ? "oauth"
                  : "dashboard",
            }),
          });
        case InstallationStep.DOMAIN:
          return apiRequest("/setup/domain", {
            ...common,
            body: jsonBody({ name: values.domain }),
          });
        case InstallationStep.INBOUND_SMOKE_TEST:
          return apiRequest("/setup/smoke-test/inbound", {
            ...common,
            body: jsonBody({ token: values.inboundToken || undefined }),
          });
        case InstallationStep.BREVO:
          return apiRequest("/setup/brevo", {
            ...common,
            body: jsonBody({
              providerKey: "brevo",
              label: values.label || "Primary Brevo",
              apiKey: values.apiKey,
              webhookSecret: values.webhookSecret,
              domainId: values.domainId,
            }),
          });
        case InstallationStep.OUTBOUND_SMOKE_TEST:
          return apiRequest("/setup/smoke-test/outbound", {
            ...common,
            body: jsonBody({
              connectionId: values.connectionId,
              from: values.from,
              to: values.to,
            }),
          });
        case InstallationStep.COMPLETE:
          return apiRequest("/setup/complete", common);
      }
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["setup-status"] });
      if (status.currentStep === InstallationStep.COMPLETE) {
        navigate("/login");
      }
    },
  });
  const oauth = useMutation({
    mutationFn: () =>
      apiRequest<{ url: string }>("/setup/cloudflare/oauth/start", {
        method: "POST",
        headers: csrfHeaders(),
      }),
    onSuccess: ({ url }) => window.location.assign(url),
  });

  const controls: Record<
    string,
    Array<{
      name: string;
      label: string;
      type?: string;
      placeholder?: string;
      required?: boolean;
    }>
  > = {
    claim: [
      {
        name: "token",
        label: "Installation token",
        type: "password",
        required: true,
      },
    ],
    admin: [
      { name: "displayName", label: "Display name", required: true },
      {
        name: "email",
        label: "Administrator email",
        type: "email",
        required: true,
      },
      {
        name: "password",
        label: "Password (12+ characters)",
        type: "password",
        required: true,
      },
    ],
    cloudflare: [
      { name: "accountId", label: "Cloudflare account ID", required: true },
      { name: "zoneId", label: "Zone ID", required: true },
    ],
    domain: [
      {
        name: "domain",
        label: "Managed mail domain",
        placeholder: "mail.example.com",
        required: true,
      },
    ],
    inbound_smoke_test: [
      {
        name: "inboundToken",
        label: "Received smoke-test token",
        placeholder: "Paste the token from the routed message",
      },
    ],
    brevo: [
      { name: "label", label: "Connection label" },
      { name: "domainId", label: "Domain ID", required: true },
      {
        name: "apiKey",
        label: "Brevo API key",
        type: "password",
        required: true,
      },
      {
        name: "webhookSecret",
        label: "Webhook bearer secret",
        type: "password",
        required: true,
      },
    ],
    outbound_smoke_test: [
      { name: "connectionId", label: "Provider connection ID", required: true },
      { name: "from", label: "From address", type: "email", required: true },
      {
        name: "to",
        label: "Destination address",
        type: "email",
        required: true,
      },
    ],
  };

  const fields = controls[status.currentStep] ?? [];
  const labels: Record<string, string> = {
    claim: "Claim installation",
    preflight: "Run preflight",
    admin: "Create administrator",
    cloudflare: "Verify Cloudflare",
    domain: "Save domain",
    inbound_smoke_test: "Verify inbound mail",
    brevo: "Validate and encrypt",
    outbound_smoke_test: "Send smoke test",
    complete: "Finish installation",
  };

  return (
    <form
      className="setup-action"
      onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
    >
      <div className="section-kicker">Current action</div>
      <h2>{labels[status.currentStep]}</h2>
      {status.currentStep === InstallationStep.CLOUDFLARE ? (
        <>
          <p className="field-note">
            Connect an OAuth client when this distribution provides one, or
            configure Email Routing in the dashboard and return for
            verification.
          </p>
          <button
            className="button secondary"
            disabled={oauth.isPending}
            onClick={() => oauth.mutate()}
            type="button"
          >
            {oauth.isPending
              ? "Opening Cloudflare…"
              : "Connect with Cloudflare OAuth"}
          </button>
          {oauth.error ? (
            <p className="field-note">
              OAuth is not configured for this distribution. Continue with
              dashboard-assisted setup below.
            </p>
          ) : null}
        </>
      ) : null}
      {fields.map((field) => (
        <label className="field" key={field.name}>
          <span>{field.label}</span>
          <input
            {...form.register(field.name, { required: field.required })}
            autoComplete={field.type === "password" ? "new-password" : "off"}
            placeholder={field.placeholder}
            type={field.type ?? "text"}
          />
        </label>
      ))}
      {mutation.error ? <ErrorState error={mutation.error} /> : null}
      {mutation.data &&
      typeof mutation.data === "object" &&
      "recoveryCodes" in mutation.data &&
      Array.isArray(mutation.data.recoveryCodes) ? (
        <section className="recovery-codes" aria-live="polite">
          <strong>Save these one-time recovery codes now</strong>
          <p>They are shown once and only their hashes are stored.</p>
          <code>{mutation.data.recoveryCodes.join("\n")}</code>
        </section>
      ) : null}
      <button className="button primary" disabled={mutation.isPending}>
        {mutation.isPending ? "Working…" : labels[status.currentStep]}
      </button>
    </form>
  );
}

export function SetupPage() {
  const status = useQuery({
    queryKey: ["setup-status"],
    queryFn: () => apiRequest<InstallationStatus>("/setup/status"),
    retry: false,
  });

  if (status.isLoading)
    return <LoadingState label="Reading installation state" />;
  if (status.error || !status.data) {
    return (
      <ErrorState error={status.error} retry={() => void status.refetch()} />
    );
  }
  const currentIndex = steps.findIndex(
    ([id]) => id === status.data.currentStep,
  );

  return (
    <main className="setup-page">
      <header className="setup-brand">
        <a className="brand-mark" href="/setup" aria-label="UniMailbox setup">
          CM
        </a>
        <div>
          <div className="section-kicker">Private deployment</div>
          <strong>UniMailbox installation</strong>
        </div>
        <span className="version-tag">
          schema v{status.data.installationVersion}
        </span>
      </header>
      <section className="setup-layout">
        <div className="setup-intro">
          <p className="display-label">
            SETUP / {String(currentIndex + 1).padStart(2, "0")}
          </p>
          <h1>Bring your mail plane online.</h1>
          <p>
            Each checkpoint is verified by the Worker before the next one
            unlocks. You can safely close this page and resume later.
          </p>
          <ol className="setup-steps" aria-label="Installation progress">
            {steps.map(([id, label, Icon], index) => {
              const done =
                status.data.completedSteps.includes(id) || index < currentIndex;
              const active = index === currentIndex;
              return (
                <li
                  aria-current={active ? "step" : undefined}
                  className={done ? "done" : active ? "active" : ""}
                  key={id}
                >
                  <span>
                    <Icon aria-hidden="true" />
                  </span>
                  <div>
                    <small>{String(index + 1).padStart(2, "0")}</small>
                    <strong>{label}</strong>
                  </div>
                  {done ? <Check aria-label="Complete" /> : null}
                </li>
              );
            })}
          </ol>
        </div>
        <SetupAction status={status.data} />
      </section>
    </main>
  );
}
