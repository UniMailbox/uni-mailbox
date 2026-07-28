const ALLOWED_TAGS = new Set([
  "a",
  "b",
  "br",
  "div",
  "em",
  "i",
  "p",
  "span",
  "strong",
  "u",
]);
const VOID_TAGS = new Set(["br"]);
const DROP_WITH_CONTENT = new Set([
  "script",
  "style",
  "form",
  "iframe",
  "object",
]);

function decodeAttribute(value: string): string {
  return value
    .replace(/&#(\d+);?/gu, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/&#x([\da-f]+);?/giu, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&colon;/giu, ":")
    .replace(/[\u0000-\u0020\u007f]+/gu, "")
    .trim();
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function safeHref(attributes: string): string | null {
  const match = attributes.match(
    /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/iu,
  );
  const value = decodeAttribute(match?.[1] ?? match?.[2] ?? match?.[3] ?? "");
  if (!/^(https?:|mailto:)/iu.test(value)) return null;
  return value;
}

export function sanitizeSignatureHtml(input: string): string {
  const tokens = input.match(/<[^>]*>|[^<]+/gu) ?? [];
  const result: string[] = [];
  const dropped: string[] = [];

  for (const token of tokens) {
    const opening = token.match(/^<\s*([a-z0-9]+)([^>]*)>$/iu);
    const closing = token.match(/^<\s*\/\s*([a-z0-9]+)\s*>$/iu);

    if (opening) {
      const tag = opening[1].toLowerCase();
      if (DROP_WITH_CONTENT.has(tag)) {
        dropped.push(tag);
        continue;
      }
      if (dropped.length > 0 || !ALLOWED_TAGS.has(tag)) continue;
      if (tag === "a") {
        const href = safeHref(opening[2]);
        result.push(href ? `<a href="${escapeAttribute(href)}">` : "<a>");
      } else {
        result.push(`<${tag}>`);
      }
      continue;
    }

    if (closing) {
      const tag = closing[1].toLowerCase();
      if (dropped.at(-1) === tag) {
        dropped.pop();
        continue;
      }
      if (
        dropped.length === 0 &&
        ALLOWED_TAGS.has(tag) &&
        !VOID_TAGS.has(tag)
      ) {
        result.push(`</${tag}>`);
      }
      continue;
    }

    if (dropped.length === 0 && !token.startsWith("<")) {
      result.push(token);
    }
  }

  return result.join("").trim();
}
