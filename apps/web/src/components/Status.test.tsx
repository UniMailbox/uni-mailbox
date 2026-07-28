import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ErrorState, LoadingState, SuccessNote } from "./Status";

describe("Status components", () => {
  it("renders the loading state with the default label", () => {
    render(<LoadingState />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading");
  });

  it("renders the loading state with a custom label", () => {
    render(<LoadingState label="Reading inbox" />);
    expect(screen.getByRole("status")).toHaveTextContent("Reading inbox");
  });

  it("renders the error state with a message", () => {
    render(<ErrorState error={new Error("Bad request")} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Bad request");
  });

  it("renders the error state without an Error instance", () => {
    render(<ErrorState error="oops" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Please try again.");
  });

  it("invokes retry handler when the retry button is clicked", () => {
    let retryCount = 0;
    render(
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
    render(
      <SuccessNote>
        <span>All saved</span>
      </SuccessNote>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("All saved");
  });
});