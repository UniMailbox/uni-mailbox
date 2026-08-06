import { useEffect } from "react";
import type { ReactNode } from "react";
import { LoaderCircle, AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { apiErrorToken } from "../i18n/errors";

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
      </div>
      {retry ? (
        <button className="button secondary" onClick={retry} type="button">
          {t("actions.retry")}
        </button>
      ) : null}
    </div>
  );
}

/**
 * Surface a confirmation through the toast layer instead of the DOM tree.
 * Render nothing so the message does not stack with form copy; the toast UI
 * itself owns accessibility (role + focus management) and a11y text.
 */
export function SuccessNote({ children }: { children: ReactNode }) {
  useEffect(() => {
    toast.success(children as Parameters<typeof toast.success>[0]);
  }, [children]);
  return null;
}
