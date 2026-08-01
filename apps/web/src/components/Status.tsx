import { AlertTriangle, CheckCircle2, LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { apiErrorToken } from "../i18n/errors";
import { BidiText } from "./BidiText";

export function LoadingState({ label }: { label?: string }) {
  const { t } = useTranslation("common");
  return (
    <div className="state-card" role="status">
      <LoaderCircle className="spin" aria-hidden="true" />
      <span>{label ?? t("states.loading")}</span>
    </div>
  );
}

export function ErrorState({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  const { t } = useTranslation(["common", "errors"]);
  const token = apiErrorToken(error);
  return (
    <div className="state-card error-state" role="alert">
      <AlertTriangle aria-hidden="true" />
      <div>
        <strong>{t("states.requestFailed")}</strong>
        <p>{String(t(token.key, token.values))}</p>
        {token.requestId ? (
          <button
            aria-label={t("actions.copyRequestId")}
            className="request-id"
            onClick={() =>
              void navigator.clipboard?.writeText(token.requestId!)
            }
            type="button"
          >
            <BidiText kind="identifier">
              <code>{token.requestId}</code>
            </BidiText>
          </button>
        ) : null}
      </div>
      {retry ? (
        <button className="button secondary" onClick={retry} type="button">
          {t("actions.retry")}
        </button>
      ) : null}
    </div>
  );
}

export function SuccessNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="success-note" role="status">
      <CheckCircle2 aria-hidden="true" />
      {children}
    </div>
  );
}
