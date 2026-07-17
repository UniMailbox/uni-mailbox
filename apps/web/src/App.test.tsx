import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";

vi.stubGlobal(
  "fetch",
  vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url.endsWith("/profiles")) {
      return Response.json({ ok: true, data: [] });
    }

    if (url.endsWith("/files")) {
      return Response.json({ ok: true, data: [] });
    }

    return Response.json({ ok: true, data: { role: "viewer", permissions: [] } });
  })
);

describe("App", () => {
  it("renders the Cloudflare resource dashboard", async () => {
    render(<App />);

    expect(screen.getByText("D1 profiles")).toBeInTheDocument();
    expect(screen.getByText("KV config")).toBeInTheDocument();
    expect(screen.getByText("R2 files")).toBeInTheDocument();
  });
});
