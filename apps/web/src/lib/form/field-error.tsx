import { useTranslation } from "react-i18next";
import { useAppFieldContext } from "./app-form";
import { zodIssueToken } from "./validation";

export function FieldError({ labelKey }: { labelKey: string }) {
  const field = useAppFieldContext<unknown>();
  const { t } = useTranslation(["common", "errors"]);
  const { errors, isTouched } = field.state.meta;
  const hasSubmitted = field.form.state.submissionAttempts > 0;

  if ((!isTouched && !hasSubmitted) || errors.length === 0) return null;

  return (
    <p className="field-error" role="alert">
      {errors.map((error, index) => {
        const token = zodIssueToken(error as Parameters<typeof zodIssueToken>[0]);
        return <span key={index}>{t(token.key, { ...token.values, field: t(labelKey) })}</span>;
      })}
    </p>
  );
}
