import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, CheckCircle2, Database, HardDrive } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ErrorState, LoadingState, SuccessNote } from "../../components/Status";
import { infrastructureQueryOptions, r2VerifyMutationOptions } from "./api";

export function StorageSettings() {
  const { t } = useTranslation("settings");
  const client = useQueryClient();
  const infrastructure = useQuery(infrastructureQueryOptions());
  const verify = useMutation(r2VerifyMutationOptions(client));
  if (infrastructure.isLoading)
    return <LoadingState label={t("storage.loading")} />;
  if (infrastructure.error || !infrastructure.data)
    return (
      <ErrorState
        error={infrastructure.error}
        retry={() => void infrastructure.refetch()}
      />
    );
  const { required, attachments } = infrastructure.data;
  return (
    <div className="configuration-stack">
      <section className="settings-card vertical">
        <div className="card-heading">
          <div>
            <span className="card-index">{t("storage.requiredIndex")}</span>
            <h2>{t("storage.requiredHeading")}</h2>
          </div>
          <Database aria-hidden="true" />
        </div>
        <p>{t("storage.requiredDescription")}</p>
        <div className="resource-grid">
          {Object.entries(required).map(([name, status]) => (
            <div className={`resource-tile ${status}`} key={name}>
              <span>{name === "d1" ? "D1" : name.toUpperCase()}</span>
              <strong>
                {status === "ok" ? (
                  <>
                    <CheckCircle2 aria-hidden="true" /> {t("storage.ready")}
                  </>
                ) : (
                  t(`storage.state.${status}`)
                )}
              </strong>
            </div>
          ))}
        </div>
      </section>
      <section className="settings-card storage-card">
        {attachments.backend === "r2" ? (
          <Archive aria-hidden="true" />
        ) : (
          <HardDrive aria-hidden="true" />
        )}
        <div>
          <div className="card-heading">
            <div>
              <span className="card-index">{t("storage.attachmentIndex")}</span>
              <h2>
                {t(
                  attachments.backend === "r2"
                    ? "storage.r2Heading"
                    : "storage.kvHeading",
                )}
              </h2>
            </div>
            <span
              className={`checkpoint-status ${attachments.backend === "r2" ? "configured" : "verified"}`}
            >
              <span aria-hidden="true" />
              {t(
                attachments.backend === "r2"
                  ? "storage.r2Bound"
                  : "storage.kvHealthy",
              )}
            </span>
          </div>
          {attachments.backend === "kv" ? (
            <>
              <div className="operator-instruction">
                <strong>{t("storage.optional")}</strong>
                <span>{t("storage.instructions")}</span>
              </div>
              <button className="button secondary" disabled type="button">
                {t("storage.verify")}
              </button>
            </>
          ) : (
            <button
              className="button primary"
              disabled={verify.isPending}
              onClick={() => verify.mutate()}
              type="button"
            >
              {t("storage.verify")}
            </button>
          )}
          {verify.error ? <ErrorState error={verify.error} /> : null}
          {verify.isSuccess ? (
            <SuccessNote>{t("storage.verified")}</SuccessNote>
          ) : null}
        </div>
      </section>
    </div>
  );
}
