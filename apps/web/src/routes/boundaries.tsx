import {
  Link,
  type ErrorComponentProps,
  type NotFoundRouteProps,
} from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ErrorState } from "../components/Status";
import { ForbiddenRouteError } from "../lib/forbidden-route-error";
import { captureRouteError } from "../lib/sentry";

export { ForbiddenRouteError } from "../lib/forbidden-route-error";

export function RouteErrorBoundary({ error, reset }: ErrorComponentProps) {
  const { t } = useTranslation("auth");
  useEffect(() => {
    captureRouteError(error, { routeId: window.location.pathname });
  }, [error]);
  if (error instanceof ForbiddenRouteError) {
    return (
      <main className="state-page">
        <div className="state-card error-state" role="alert">
          <ShieldAlert aria-hidden="true" />
          <div>
            <strong>{t("forbidden.title")}</strong>
            <p>
              {t("forbidden.description", { permission: error.permission })}
            </p>
          </div>
          <Link className="button secondary" to="/inbox">
            {t("forbidden.backToInbox")}
          </Link>
        </div>
      </main>
    );
  }
  return <ErrorState error={error} retry={reset} />;
}

export function RouteNotFoundBoundary(_props: NotFoundRouteProps) {
  const { t } = useTranslation("auth");
  return (
    <main className="state-page">
      <div className="state-card error-state" role="alert">
        <div>
          <strong>{t("notFound.title")}</strong>
          <p>{t("notFound.description")}</p>
        </div>
        <Link className="button secondary" to="/inbox">
          {t("notFound.backToInbox")}
        </Link>
      </div>
    </main>
  );
}
