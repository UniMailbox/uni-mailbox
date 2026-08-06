import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { I18nextProvider } from "react-i18next";
import { ApiClientError } from "../lib/api/errors";
import { createTestI18n } from "../i18n/test-instance";
import { ErrorState, LoadingState, SuccessNote } from "./Status";

const toastSuccessSpy = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessSpy(...args),
    error: vi.fn(),
    info: vi.fn(),
    loading: vi.fn(),
  },
  Toaster: () => null,
}));

function renderLocalized(ui: React.ReactElement) {
  return render(
    <I18nextProvider i18n={createTestI18n("en")}>{ui}</I18nextProvider>,
  );
}

describe("Status components", () => {
  beforeEach(() => {
    toastSuccessSpy.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders the loading state with the default label", () => {
    renderLocalized(<LoadingState />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading");
  });

  it("renders the loading state with a custom label", () => {
    renderLocalized(<LoadingState label="Reading inbox" />);
    expect(screen.getByRole("status")).toHaveTextContent("Reading inbox");
  });

  it("uses a localized API error for the request failure", () => {
    renderLocalized(
      <ErrorState
        error={
          new ApiClientError("AUTH_REQUIRED", 401, {
            diagnosticMessage: "Bad request",
            requestId: "request-1",
          })
        }
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Authentication is required.",
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent("Bad request");
  });

  it("does not surface the request id in the DOM tree", () => {
    renderLocalized(
      <ErrorState
        error={
          new ApiClientError("AUTH_REQUIRED", 401, { requestId: "request-1" })
        }
      />,
    );

    expect(screen.queryByText("request-1")).toBeNull();
    expect(screen.queryByRole("button", { name: /request/i })).toBeNull();
  });

  it("renders the error state without an Error instance", () => {
    renderLocalized(<ErrorState error="oops" />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Something went wrong.",
    );
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

  it("forwards success messages through toast and renders nothing in the DOM", () => {
    const { container } = renderLocalized(
      <SuccessNote>
        <span>All saved</span>
      </SuccessNote>,
    );
    expect(toastSuccessSpy).toHaveBeenCalledTimes(1);
    expect(container.firstChild).toBeNull();
  });
});
