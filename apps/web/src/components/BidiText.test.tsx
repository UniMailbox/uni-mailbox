import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BidiText } from "./BidiText";

describe("BidiText", () => {
  it("isolates names and subjects using automatic direction", () => {
    render(<BidiText>مرحبا Alice</BidiText>);

    expect(screen.getByText("مرحبا Alice")).toHaveAttribute("dir", "auto");
    expect(screen.getByText("مرحبا Alice").tagName).toBe("BDI");
  });

  it("keeps technical identifiers LTR and isolated", () => {
    render(<BidiText kind="identifier">ops@example.com</BidiText>);

    const value = screen.getByText("ops@example.com");
    expect(value).toHaveAttribute("dir", "ltr");
    expect(value).toHaveClass("bidi-identifier");
  });
});
