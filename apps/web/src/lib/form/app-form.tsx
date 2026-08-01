import { createFormHook, createFormHookContexts } from "@tanstack/react-form";
import { useTranslation } from "react-i18next";
import { FieldError } from "./field-error";

const { fieldContext, formContext, useFieldContext, useFormContext } =
  createFormHookContexts();

export const useAppFieldContext = useFieldContext;

type SubmittableForm = {
  handleSubmit(): Promise<void>;
};

type FormRootProps = Omit<
  React.ComponentPropsWithoutRef<"form">,
  "noValidate" | "onSubmit"
> & {
  form: SubmittableForm;
};

/**
 * Bridges a native form submission into TanStack Form.
 *
 * Native constraint validation is deliberately disabled: shared contract
 * schemas own validation and produce localized `FieldError` feedback. Without
 * `noValidate`, the browser can reject an email or required value before the
 * React submit handler and TanStack validators run.
 */
function FormRoot({ form, ...props }: FormRootProps) {
  return (
    <form
      {...props}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    />
  );
}

type InputProps = {
  label: string;
  placeholder?: string;
  autoComplete?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
};

function TextField({
  label,
  placeholder,
  autoComplete,
  inputMode,
}: InputProps) {
  const field = useFieldContext<string>();
  const { t } = useTranslation("common");
  const id = field.name;

  return (
    <label htmlFor={id}>
      <span>{t(label)}</span>
      <input
        autoComplete={autoComplete}
        id={id}
        inputMode={inputMode}
        onBlur={field.handleBlur}
        onChange={(event) => field.handleChange(event.target.value)}
        placeholder={placeholder ? t(placeholder) : undefined}
        value={field.state.value ?? ""}
      />
      <FieldError labelKey={label} />
    </label>
  );
}

function PasswordField(props: InputProps) {
  const field = useFieldContext<string>();
  const { t } = useTranslation("common");
  const id = field.name;

  return (
    <label htmlFor={id}>
      <span>{t(props.label)}</span>
      <input
        autoComplete={props.autoComplete}
        id={id}
        inputMode={props.inputMode}
        onBlur={field.handleBlur}
        onChange={(event) => field.handleChange(event.target.value)}
        placeholder={props.placeholder ? t(props.placeholder) : undefined}
        type="password"
        value={field.state.value ?? ""}
      />
      <FieldError labelKey={props.label} />
    </label>
  );
}

/**
 * Keeps submit reachable after a failed submit-only validation attempt.
 * `canSubmit` becomes false while errors exist, so using it as `disabled`
 * would prevent users from submitting the corrected values.
 */
function SubmitButton({
  children,
  disabled,
  ...props
}: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "type">) {
  const form = useFormContext();
  return (
    <form.Subscribe selector={(state) => state.isSubmitting}>
      {(isSubmitting) => (
        <button {...props} disabled={disabled || isSubmitting} type="submit">
          {children}
        </button>
      )}
    </form.Subscribe>
  );
}

export const { useAppForm } = createFormHook({
  fieldContext,
  formContext,
  fieldComponents: { TextField, PasswordField },
  formComponents: { SubmitButton },
});

export { FormRoot, TextField, PasswordField, SubmitButton, FieldError };
