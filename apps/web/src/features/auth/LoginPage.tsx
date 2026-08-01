import { ArrowRight, LockKeyhole, Radio } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { LoginSchema } from "@unimailbox/contracts";
import { useTranslation } from "react-i18next";
import { useAppForm } from "../../lib/form/app-form";
import { loginMutationOptions } from "./api";
import { safeLoginTarget } from "../../app/router";
import { ErrorState } from "../../components/Status";

export function LoginPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { next?: string };
  const { t } = useTranslation("auth");
  const login = useMutation(loginMutationOptions(queryClient));
  const form = useAppForm({
    defaultValues: { email: "", password: "" },
    validators: { onSubmit: LoginSchema },
    onSubmit: async ({ value }) => {
      await login.mutateAsync(value);
      await navigate({ to: safeLoginTarget(search.next), replace: true });
    },
  });

  return (
    <main className="auth-page">
      <section className="auth-signal" aria-hidden="true">
        <div className="signal-grid" />
        <div className="signal-copy">
          <Radio />
          <p>{t("login.status")}</p>
          <strong>{t("login.awaitingOperator")}</strong>
        </div>
      </section>
      <section className="auth-panel">
        <Link className="wordmark" to="/login">
          <span>CM</span> UniMailbox
        </Link>
        <div className="auth-form-wrap">
          <div className="section-kicker">{t("login.kicker")}</div>
          <h1>{t("login.title")}</h1>
          <p className="lede">{t("login.description")}</p>
          <form
            className="form-stack"
            onSubmit={(event) => {
              event.preventDefault();
              void form.handleSubmit();
            }}
          >
            <form.AppField name="email">
              {(field) => (
                <label className="field">
                  <span>{t("login.email")}</span>
                  <input
                    autoComplete="email"
                    dir="ltr"
                    inputMode="email"
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder={t("login.emailPlaceholder")}
                    type="email"
                    value={field.state.value}
                  />
                </label>
              )}
            </form.AppField>
            <form.AppField name="password">
              {(field) => (
                <label className="field">
                  <span>{t("login.password")}</span>
                  <input
                    autoComplete="current-password"
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    type="password"
                    value={field.state.value}
                  />
                </label>
              )}
            </form.AppField>
            {login.error ? <ErrorState error={login.error} /> : null}
            <form.Subscribe
              selector={(state) =>
                [state.canSubmit, state.isSubmitting] as const
              }
            >
              {([canSubmit, isSubmitting]) => (
                <button
                  className="button primary auth-submit"
                  disabled={!canSubmit || isSubmitting}
                  type="submit"
                >
                  <LockKeyhole aria-hidden="true" />
                  {isSubmitting ? t("login.submitting") : t("login.submit")}
                  <ArrowRight aria-hidden="true" className="directional-icon" />
                </button>
              )}
            </form.Subscribe>
          </form>
        </div>
        <footer>{t("login.footer")}</footer>
      </section>
    </main>
  );
}
