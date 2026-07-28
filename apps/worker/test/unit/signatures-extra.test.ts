import { describe, expect, it } from "vitest";
import { sanitizeSignatureHtml } from "../../src/modules/signatures";

describe("sanitizeSignatureHtml additional cases", () => {
  it("decodes numeric character references inside href attributes", () => {
    const sanitized = sanitizeSignatureHtml(
      '<a href="https://&#109;ail.example">x</a>',
    );
    expect(sanitized).toBe('<a href="https://mail.example">x</a>');
  });

  it("decodes &colon; and strips control characters from attributes", () => {
    const sanitized = sanitizeSignatureHtml(
      '<a href="https://example.com\t :">link</a>',
    );
    expect(sanitized).toBe('<a href="https://example.com:">link</a>');
  });

  it("drops disallowed tags and bracketed text while keeping safe text", () => {
    const sanitized = sanitizeSignatureHtml(
      "<p>Hello <strong>world</strong> <unknown>kept?</unknown> <div>block</div></p>",
    );
    expect(sanitized).toBe(
      "<p>Hello <strong>world</strong> kept? <div>block</div></p>",
    );
  });

  it("omits a closing tag for a void element", () => {
    expect(sanitizeSignatureHtml("text<br>more")).toBe("text<br>more");
  });

  it("drops content inside drop-with-content elements and their close tags", () => {
    const sanitized = sanitizeSignatureHtml(
      "<p>safe<script>nope</script>after</p>",
    );
    expect(sanitized).toBe("<p>safeafter</p>");
  });

  it("skips content inside <style> tags and any following tags", () => {
    const sanitized = sanitizeSignatureHtml(
      "<p>before<style>body{}</style><div>dropped</div></p>",
    );
    expect(sanitized).toBe("<p>before<div>dropped</div></p>");
  });

  it("drops form, iframe, object, and their inner content", () => {
    const sanitized = sanitizeSignatureHtml(
      "<form><input/></form><iframe>x</iframe><object>y</object>",
    );
    expect(sanitized).toBe("");
  });

  it("strips href when the protocol is not http(s) or mailto", () => {
    expect(sanitizeSignatureHtml('<a href="javascript:bad()">x</a>')).toBe(
      "<a>x</a>",
    );
    expect(sanitizeSignatureHtml('<a href="data:text/plain,x">x</a>')).toBe(
      "<a>x</a>",
    );
  });

  it("drops tel: links because they don't match http(s) or mailto schemes", () => {
    expect(sanitizeSignatureHtml('<a href="tel:+1555">x</a>')).toBe("<a>x</a>");
  });

  it("ignores close tags for tags that were dropped", () => {
    const sanitized = sanitizeSignatureHtml(
      "<script>1</script>after<script>2</script>",
    );
    expect(sanitized).toBe("after");
  });

  it("returns an empty string when the input is empty", () => {
    expect(sanitizeSignatureHtml("")).toBe("");
  });

  it("preserves plain text without HTML markup", () => {
    expect(sanitizeSignatureHtml("Plain text only.")).toBe("Plain text only.");
  });

  it("drops the closing tag of a tag that was dropped without keeping track", () => {
    expect(sanitizeSignatureHtml("<script></script><p>ok</p>")).toBe(
      "<p>ok</p>",
    );
  });

  it("decodes hex character references in attributes", () => {
    const sanitized = sanitizeSignatureHtml(
      '<a href="https://&#x6D;ail.example">x</a>',
    );
    expect(sanitized).toBe('<a href="https://mail.example">x</a>');
  });

  it("preserves single-quoted and unquoted href attributes", () => {
    expect(
      sanitizeSignatureHtml("<a href='https://example.com'>single</a>"),
    ).toBe('<a href="https://example.com">single</a>');
    expect(sanitizeSignatureHtml("<a href=https://example.com>bare</a>")).toBe(
      '<a href="https://example.com">bare</a>',
    );
  });

  it("preserves mailto: links and rejects other schemes", () => {
    expect(
      sanitizeSignatureHtml('<a href="mailto:user@example.com">mail</a>'),
    ).toBe('<a href="mailto:user@example.com">mail</a>');
    expect(sanitizeSignatureHtml('<a href="ftp://example.com">ftp</a>')).toBe(
      "<a>ftp</a>",
    );
  });

  it("returns an anchor tag without href when the protocol is missing", () => {
    expect(sanitizeSignatureHtml("<a>plain</a>")).toBe("<a>plain</a>");
  });
});
