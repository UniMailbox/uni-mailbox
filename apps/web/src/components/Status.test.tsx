import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { I18nextProvider } from "react-i18next";
import { ApiClientError } from "../lib/api/errors";
import { createTestI18n } from "../i18n/test-instance";
import { ErrorState, LoadingState, SuccessNote } from "./Status";

function renderLocalized(ui: React.ReactElement) {
  return render(
    <I18nextProvider i18n={createTestI18n("en")}>{ui}</I18nextProvider>,
  );
}

function renderPseudoLocalized(ui: React.ReactElement) {
  return render(
    <I18nextProvider i18n={createTestI18n("ar-XB")}>{ui}</I18nextProvider>,
  );
}

describe("Status components", () => {
  it("renders the loading state with the default label", () => {
    renderLocalized(<LoadingState />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading");
  });

  it("renders the loading state with a custom label", () => {
    renderLocalized(<LoadingState label="Reading inbox" />);
    expect(screen.getByRole("status")).toHaveTextContent("Reading inbox");
  });

  it("uses a localized API error instead of a diagnostic server message", () => {
    renderLocalized(
      <ErrorState
        error={new ApiClientError("AUTH_REQUIRED", 401, {
          diagnosticMessage: "Bad request",
          requestId: "request-1",
        })}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Authentication is required.");
    expect(screen.getByRole("alert")).not.toHaveTextContent("Bad request");
    expect(screen.getByText("request-1").closest("bdi")).toHaveAttribute("dir", "ltr");
  });

  it("isolates request IDs in the RTL pseudo-locale", () => {
    renderPseudoLocalized(
      <ErrorState error={new ApiClientError("AUTH_REQUIRED", 401, { requestId: "request-rtl" })} />,
    );

    expect(screen.getByText("request-rtl").closest("bdi")).toHaveAttribute("dir", "ltr");
  });

  it("renders the error state without an Error instance", () => {
    renderLocalized(<ErrorState error="oops" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong.");
  });

  it("invokes retry handler when the retry button is clicked", () => {
    let retryCount = 0;
    renderLocalized(
      <ErrorState
        error={new Error("Bad request")}
        retry={() => {
          retryCount += 1;
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retryCount).toBe(1);
  });

  it("renders the success note with children", () => {
    renderLocalized(
      <SuccessNote>
        <span>All saved</span>
      </SuccessNote>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("All saved");
  });
});
