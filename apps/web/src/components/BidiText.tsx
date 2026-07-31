import type { ReactNode } from "react";

/**
 * Isolate values that may use a different writing direction than the UI.
 * Product copy follows the document direction; user content and technical
 * diagnostics must not reorder surrounding RTL text.
 */
export function BidiText({
  children,
  kind = "auto",
}: {
  children?: ReactNode;
  kind?: "auto" | "identifier";
}) {
  return kind === "identifier" ? (
    <bdi className="bidi-identifier" dir="ltr">
      {children}
    </bdi>
  ) : (
    <bdi dir="auto">{children}</bdi>
  );
}
