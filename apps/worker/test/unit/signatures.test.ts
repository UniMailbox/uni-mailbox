import { describe, expect, it } from "vitest";
import { sanitizeSignatureHtml } from "../../src/modules/signatures";

describe("signature sanitization", () => {
  it("removes scripts, event handlers, forms, and unsafe URLs", () => {
    const sanitized = sanitizeSignatureHtml(`
      <p onclick="steal()">Hello <a href="javascript:steal()">link</a></p>
      <script>steal()</script>
      <form action="https://evil.example"><input /></form>
    `);

    expect(sanitized).toContain("<p>Hello <a>link</a></p>");
    expect(sanitized).not.toMatch(/onclick|javascript:|script|form|input/i);
  });

  it("preserves safe formatting and HTTPS links", () => {
    expect(
      sanitizeSignatureHtml(
        '<p><strong>UniMailbox</strong> · <a href="https://example.com">Site</a></p>',
      ),
    ).toBe(
      '<p><strong>UniMailbox</strong> · <a href="https://example.com">Site</a></p>',
    );
  });
});
