import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Cloud,
  MailCheck,
  RadioTower,
  Send,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import {
  CloudflareBrevoConnectSchema,
  CloudflareDomainCreateSchema,
  CloudflareOutboundSmokeTestSchema,
  CloudflareVerifySchema,
} from "@unimailbox/contracts";
import { ErrorState, LoadingState, SuccessNote } from "../../components/Status";
import { BidiText } from "../../components/BidiText";
import { useAppForm } from "../../lib/form/app-form";
import {
  cloudflareDomainMutationOptions,
  cloudflareInboundMutationOptions,
  cloudflareOauthRevokeMutationOptions,
  cloudflareOauthStartMutationOptions,
  cloudflareOutboundMutationOptions,
  cloudflareProviderMutationOptions,
  cloudflareStatusQueryOptions,
  cloudflareVerifyMutationOptions,
} from "./api";

function Submit({
  children,
  disabled,
}: {
  children: React.ReactNode;
  disabled: boolean;
}) {
  return (
    <button className="button primary" disabled={disabled} type="submit">
      {children}
    </button>
  );
}
function CheckpointStatus({
  status,
}: {
  status?: "pending" | "configured" | "verified" | "failed";
}) {
  const { t } = useTranslation("settings");
  const value = status ?? "pending";
  return (
    <span className={`checkpoint-status ${value}`}>
      <span aria-hidden="true" />
      {t(`cloudflare.status.${value}`)}
    </span>
  );
}

export function followCloudflareOauth(
  url: string,
  location: Pick<Location, "assign"> = window.location,
): void {
  location.assign(url);
}

export function CloudflareSettings() {
  const { t } = useTranslation("settings");
  const client = useQueryClient();
  const [inboundToken, setInboundToken] = useState<string>();
  const checkpoints = useQuery(cloudflareStatusQueryOptions());
  const checkpoint = (key: string) =>
    checkpoints.data?.find(
      (item: { checkpointKey: string }) => item.checkpointKey === key,
    );
  const oauth = useMutation(cloudflareOauthStartMutationOptions(client));
  const revoke = useMutation(cloudflareOauthRevokeMutationOptions(client));
  const verify = useMutation(cloudflareVerifyMutationOptions(client));
  const domain = useMutation(cloudflareDomainMutationOptions(client));
  const inbound = useMutation(cloudflareInboundMutationOptions(client));
  const brevo = useMutation(cloudflareProviderMutationOptions(client));
  const outbound = useMutation(cloudflareOutboundMutationOptions(client));
  const verifyForm = useAppForm({
    defaultValues: {
      accountId: "",
      zoneId: "",
      mode: "dashboard" as "dashboard" | "oauth",
    },
    validators: { onSubmit: CloudflareVerifySchema },
    onSubmit: async ({ value }) => {
      await verify.mutateAsync(value);
    },
  });
  const domainForm = useAppForm({
    defaultValues: { name: "" },
    validators: { onSubmit: CloudflareDomainCreateSchema },
    onSubmit: async ({ value }) => {
      await domain.mutateAsync(value);
      domainForm.reset();
    },
  });
  const brevoForm = useAppForm({
    defaultValues: {
      label: "Primary Brevo",
      apiKey: "",
      webhookSecret: "",
      domainId: "",
    },
    validators: {
      onSubmit: CloudflareBrevoConnectSchema.omit({ providerKey: true }),
    },
    onSubmit: async ({ value }) => {
      await brevo.mutateAsync(value);
      brevoForm.reset({
        label: "Primary Brevo",
        apiKey: "",
        webhookSecret: "",
        domainId: "",
      });
    },
  });
  const outboundForm = useAppForm({
    defaultValues: { connectionId: "", from: "", to: "" },
    validators: { onSubmit: CloudflareOutboundSmokeTestSchema },
    onSubmit: async ({ value }) => {
      await outbound.mutateAsync(value);
    },
  });
  if (checkpoints.isLoading)
    return <LoadingState label={t("cloudflare.loading")} />;
  if (checkpoints.error)
    return (
      <ErrorState
        error={checkpoints.error}
        retry={() => void checkpoints.refetch()}
      />
    );
  return (
    <div className="configuration-stack">
      <section className="settings-card configuration-hero">
        <Cloud aria-hidden="true" />
        <div>
          <div className="card-heading">
            <div>
              <span className="card-index">{t("cloudflare.accountIndex")}</span>
              <h2>{t("cloudflare.accountHeading")}</h2>
            </div>
            <CheckpointStatus status={checkpoint("cloudflare_mail")?.status} />
          </div>
          <p>{t("cloudflare.accountDescription")}</p>
          <div className="button-row">
            <button
              className="button primary"
              disabled={oauth.isPending}
              onClick={() =>
                oauth.mutate(undefined, {
                  onSuccess: ({ url }) => followCloudflareOauth(url),
                })
              }
              type="button"
            >
              <Cloud aria-hidden="true" />
              {t("cloudflare.oauthConnect")}
            </button>
            <button
              className="button secondary"
              disabled={revoke.isPending}
              onClick={() => revoke.mutate()}
              type="button"
            >
              {t("cloudflare.oauthRevoke")}
            </button>
          </div>
          {oauth.error ? <ErrorState error={oauth.error} /> : null}
          {revoke.error ? <ErrorState error={revoke.error} /> : null}
          {revoke.isSuccess ? (
            <SuccessNote>
              {revoke.data.revoked
                ? t("cloudflare.oauthRemoved")
                : t("cloudflare.oauthAbsent")}
            </SuccessNote>
          ) : null}
          <form
            className="configuration-form three-column"
            onSubmit={(event) => {
              event.preventDefault();
              void verifyForm.handleSubmit();
            }}
          >
            <verifyForm.AppField name="accountId">
              {(field) => (
                <label className="field">
                  <span>{t("cloudflare.accountId")}</span>
                  <input
                    dir="ltr"
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    value={field.state.value}
                  />
                </label>
              )}
            </verifyForm.AppField>
            <verifyForm.AppField name="zoneId">
              {(field) => (
                <label className="field">
                  <span>{t("cloudflare.zoneId")}</span>
                  <input
                    dir="ltr"
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    value={field.state.value}
                  />
                </label>
              )}
            </verifyForm.AppField>
            <verifyForm.AppField name="mode">
              {(field) => (
                <label className="field">
                  <span>{t("cloudflare.mode")}</span>
                  <select
                    onChange={(event) =>
                      field.handleChange(
                        event.target.value as "dashboard" | "oauth",
                      )
                    }
                    value={field.state.value}
                  >
                    <option value="dashboard">
                      {t("cloudflare.dashboardMode")}
                    </option>
                    <option value="oauth">{t("cloudflare.oauth")}</option>
                  </select>
                </label>
              )}
            </verifyForm.AppField>
            <Submit disabled={verify.isPending}>
              <ShieldCheck aria-hidden="true" /> {t("cloudflare.saveVerify")}
            </Submit>
          </form>
          {verify.error ? <ErrorState error={verify.error} /> : null}
        </div>
      </section>
      <div className="configuration-grid">
        <section className="settings-card vertical">
          <div className="card-heading">
            <div>
              <span className="card-index">{t("cloudflare.domainIndex")}</span>
              <h2>{t("cloudflare.domainHeading")}</h2>
            </div>
            <RadioTower aria-hidden="true" />
          </div>
          <p>{t("cloudflare.domainDescription")}</p>
          <form
            className="form-stack"
            onSubmit={(event) => {
              event.preventDefault();
              void domainForm.handleSubmit();
            }}
          >
            <domainForm.AppField name="name">
              {(field) => (
                <label className="field">
                  <span>{t("cloudflare.domain")}</span>
                  <input
                    dir="ltr"
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder="mail.example.com"
                    value={field.state.value}
                  />
                </label>
              )}
            </domainForm.AppField>
            <Submit disabled={domain.isPending}>
              {t("cloudflare.addDomain")}
            </Submit>
          </form>
          {domain.error ? <ErrorState error={domain.error} /> : null}
          {domain.isSuccess ? (
            <SuccessNote>
              <Trans
                components={{ name: <BidiText kind="identifier" /> }}
                i18nKey="cloudflare.domainReady"
                ns="settings"
                values={{ name: domain.data.name }}
              />
            </SuccessNote>
          ) : null}
        </section>
        <section className="settings-card vertical">
          <div className="card-heading">
            <div>
              <span className="card-index">{t("cloudflare.inboundIndex")}</span>
              <h2>{t("cloudflare.inboundHeading")}</h2>
            </div>
            <CheckpointStatus
              status={checkpoint("inbound_smoke_test")?.status}
            />
          </div>
          <p>{t("cloudflare.inboundDescription")}</p>
          {inbound.data?.status === "awaiting_message" &&
          inbound.data.recipient ? (
            <div className="operator-instruction">
              <span>{t("cloudflare.sendTo")}</span>
              <strong>
                <BidiText kind="identifier">{inbound.data.recipient}</BidiText>
              </strong>
              <span>{t("cloudflare.subject")}</span>
              <BidiText kind="identifier">
                <code>{inbound.data.subject}</code>
              </BidiText>
            </div>
          ) : null}
          <button
            className="button secondary"
            disabled={inbound.isPending}
            onClick={() => {
              void inbound
                .mutateAsync(inboundToken)
                .then((result) =>
                  setInboundToken(
                    result.status === "awaiting_message"
                      ? result.token
                      : undefined,
                  ),
                );
            }}
            type="button"
          >
            <MailCheck aria-hidden="true" />
            {inboundToken
              ? t("cloudflare.checkMessage")
              : t("cloudflare.startInbound")}
          </button>
          {inbound.error ? <ErrorState error={inbound.error} /> : null}
        </section>
        <section className="settings-card vertical">
          <div className="card-heading">
            <div>
              <span className="card-index">
                {t("cloudflare.providerIndex")}
              </span>
              <h2>{t("cloudflare.providerHeading")}</h2>
            </div>
            <CheckpointStatus status={checkpoint("brevo")?.status} />
          </div>
          <p>{t("cloudflare.providerDescription")}</p>
          <form
            className="form-stack"
            onSubmit={(event) => {
              event.preventDefault();
              void brevoForm.handleSubmit();
            }}
          >
            {(["label", "domainId", "apiKey", "webhookSecret"] as const).map(
              (name) => (
                <brevoForm.AppField key={name} name={name}>
                  {(field) => (
                    <label className="field">
                      <span>
                        {t(
                          `cloudflare.${name === "domainId" ? "domainId" : name === "apiKey" ? "apiKey" : name === "webhookSecret" ? "webhookSecret" : "connectionLabel"}`,
                        )}
                      </span>
                      <input
                        dir={name === "label" ? undefined : "ltr"}
                        onBlur={field.handleBlur}
                        onChange={(event) =>
                          field.handleChange(event.target.value)
                        }
                        type={
                          name === "apiKey" || name === "webhookSecret"
                            ? "password"
                            : "text"
                        }
                        value={field.state.value}
                      />
                    </label>
                  )}
                </brevoForm.AppField>
              ),
            )}
            <Submit disabled={brevo.isPending}>
              {t("cloudflare.connectBrevo")}
            </Submit>
          </form>
          {brevo.error ? <ErrorState error={brevo.error} /> : null}
          {brevo.isSuccess ? (
            <SuccessNote>
              {t("cloudflare.connectionId")}:{" "}
              <BidiText kind="identifier">
                <code>{brevo.data.connectionId}</code>
              </BidiText>
            </SuccessNote>
          ) : null}
        </section>
        <section className="settings-card vertical">
          <div className="card-heading">
            <div>
              <span className="card-index">
                {t("cloudflare.deliveryIndex")}
              </span>
              <h2>{t("cloudflare.deliveryHeading")}</h2>
            </div>
            <CheckpointStatus
              status={checkpoint("outbound_smoke_test")?.status}
            />
          </div>
          <p>{t("cloudflare.deliveryDescription")}</p>
          <form
            className="form-stack"
            onSubmit={(event) => {
              event.preventDefault();
              void outboundForm.handleSubmit();
            }}
          >
            {(["connectionId", "from", "to"] as const).map((name) => (
              <outboundForm.AppField key={name} name={name}>
                {(field) => (
                  <label className="field">
                    <span>{t(`cloudflare.${name}`)}</span>
                    <input
                      dir="ltr"
                      onBlur={field.handleBlur}
                      onChange={(event) =>
                        field.handleChange(event.target.value)
                      }
                      type={name === "connectionId" ? "text" : "email"}
                      value={field.state.value}
                    />
                  </label>
                )}
              </outboundForm.AppField>
            ))}
            <Submit disabled={outbound.isPending}>
              <Send aria-hidden="true" /> {t("cloudflare.sendTest")}
            </Submit>
          </form>
          {outbound.error ? <ErrorState error={outbound.error} /> : null}
          {outbound.isSuccess ? (
            <SuccessNote>{t("cloudflare.outboundAccepted")}</SuccessNote>
          ) : null}
        </section>
      </div>
      <a
        className="dashboard-link"
        href="https://dash.cloudflare.com/"
        rel="noreferrer"
        target="_blank"
      >
        {t("cloudflare.dashboard")} <ArrowUpRight aria-hidden="true" />
      </a>
    </div>
  );
}
