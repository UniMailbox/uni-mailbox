import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
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

function RecoverableSubmitForm({ onSubmit }: { onSubmit: () => void }) {
  const form = useAppForm({
    defaultValues: { value: "" },
    validators: {
      onSubmit: z.object({ value: z.string().min(2) }),
    },
    onSubmit,
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.AppForm>
        <form.AppField name="value">
          {(field) => <field.TextField label="states.loading" />}
        </form.AppField>
        <form.SubmitButton>Submit</form.SubmitButton>
      </form.AppForm>
    </form>
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

  it("keeps submit reachable after submit-only validation fails", async () => {
    const onSubmit = vi.fn();
    render(
      <I18nextProvider i18n={createTestI18n("en")}>
        <RecoverableSubmitForm onSubmit={onSubmit} />
      </I18nextProvider>,
    );
    const button = screen.getByRole("button", { name: "Submit" });

    fireEvent.click(button);

    expect(await screen.findByRole("alert")).toBeVisible();
    expect(button).toBeEnabled();

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "ok" },
    });
    fireEvent.click(button);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
  });
});
