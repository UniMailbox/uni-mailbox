import { useTranslation } from "react-i18next";
import { useAppFieldContext } from "./app-form";
import { zodIssueToken } from "./validation";

function isZodIssue(
  error: unknown,
): error is Parameters<typeof zodIssueToken>[0] {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "path" in error &&
    typeof error.code === "string" &&
    Array.isArray(error.path)
  );
}

export function FieldError({
  labelKey,
  label,
}: {
  labelKey?: string;
  label?: string;
}) {
  const field = useAppFieldContext<unknown>();
  const { t } = useTranslation(["common", "errors"]);
  const { errors, isTouched } = field.state.meta;
  const hasSubmitted = field.form.state.submissionAttempts > 0;

  if ((!isTouched && !hasSubmitted) || errors.length === 0) return null;

  return (
    <p className="field-error" role="alert">
      {errors.map((error, index) => {
        const token = isZodIssue(error)
          ? zodIssueToken(error)
          : { key: "errors:validation.invalidType" as const, values: {} };
        return (
          <span key={index}>
            {t(token.key, {
              ...token.values,
              field: label ?? t(labelKey ?? "fields.value"),
            })}
          </span>
        );
      })}
    </p>
  );
}
