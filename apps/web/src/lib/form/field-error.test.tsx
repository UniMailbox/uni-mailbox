import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";
import { createTestI18n } from "../../i18n/test-instance";
import { useAppForm } from "./app-form";

function StringValidatorForm({
  validateOn,
}: {
  validateOn: "blur" | "submit";
}) {
  const form = useAppForm({
    defaultValues: { value: "" },
    onSubmit: () => undefined,
  });
  const validators =
    validateOn === "blur"
      ? { onBlur: () => "validator-only failure" }
      : { onSubmit: () => "validator-only failure" };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.AppForm>
        <form.AppField name="value" validators={validators}>
          {(field) => <field.TextField label="states.loading" />}
        </form.AppField>
      </form.AppForm>
      <button type="submit">Submit</button>
    </form>
  );
}

function PasswordFieldForm() {
  const form = useAppForm({ defaultValues: { value: "" } });

  return (
    <form.AppForm>
      <form.AppField name="value">
        {(field) => (
          <field.PasswordField inputMode="text" label="states.loading" />
        )}
      </form.AppField>
    </form.AppForm>
  );
}

function renderLocalized(validateOn: "blur" | "submit") {
  return render(
    <I18nextProvider i18n={createTestI18n("en")}>
      <StringValidatorForm validateOn={validateOn} />
    </I18nextProvider>,
  );
}

describe("application field errors", () => {
  it("renders a localized fallback after touch for a string validator error", () => {
    renderLocalized("blur");

    fireEvent.blur(screen.getAllByLabelText("Loading")[0]!);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter a valid Loading.",
    );
  });

  it("renders a localized fallback after submit for an untouched string validator error", async () => {
    renderLocalized("submit");

    fireEvent.submit(
      screen.getByRole("button", { name: "Submit" }).closest("form")!,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Enter a valid Loading.",
    );
  });

  it("passes input mode to password fields", () => {
    render(
      <I18nextProvider i18n={createTestI18n("en")}>
        <PasswordFieldForm />
      </I18nextProvider>,
    );

    expect(screen.getByLabelText("Loading")).toHaveAttribute(
      "inputmode",
      "text",
    );
  });
});
