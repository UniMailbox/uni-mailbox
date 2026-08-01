import { useEffect, useState } from "react";

/** Where an operator lands after a successful sign-in with no saved intent. */
export const DEFAULT_AFTER_LOGIN = "/inbox";

export function navigate(to: string): void {
  if (`${window.location.pathname}${window.location.search}` === to) return;
  window.history.pushState({}, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/**
 * Replace the current entry instead of pushing a new one. Guard redirects use
 * this so the browser Back button does not bounce the operator straight back
 * into the protected route they were just denied.
 */
export function redirect(to: string): void {
  if (`${window.location.pathname}${window.location.search}` === to) return;
  window.history.replaceState({}, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export interface Location {
  pathname: string;
  search: string;
}

function readLocation(): Location {
  return {
    pathname: window.location.pathname,
    search: window.location.search,
  };
}

export function useLocation(): Location {
  const [location, setLocation] = useState(readLocation);
  useEffect(() => {
    const update = () =>
      setLocation((previous) => {
        const next = readLocation();
        // Keep the identity stable when nothing changed so consumers that
        // depend on the object do not re-run their effects on every popstate.
        return previous.pathname === next.pathname &&
          previous.search === next.search
          ? previous
          : next;
      });
    window.addEventListener("popstate", update);
    // A popstate may have fired between the initial render and this effect
    // attaching (guards redirect during render commit); resync once.
    update();
    return () => window.removeEventListener("popstate", update);
  }, []);
  return location;
}

export function usePathname(): string {
  return useLocation().pathname;
}

/**
 * Build the `/login` URL that remembers where the operator was heading, so the
 * post-login redirect returns them to the deep link they opened.
 */
export function loginPathFor(pathname: string, search = ""): string {
  if (pathname === "/login" || pathname === "/register") return "/login";
  const target = `${pathname}${search}`;
  if (!target || target === "/" || target === DEFAULT_AFTER_LOGIN) {
    return "/login";
  }
  return `/login?next=${encodeURIComponent(target)}`;
}

/**
 * Read the post-login destination from the login URL.
 *
 * Only root-relative, single-slash paths are honoured. Without this check,
 * `?next=https://evil.example` or `?next=//evil.example` would turn the login
 * page into an open redirect that carries a freshly minted session with it.
 * Backslashes are rejected too: several browsers normalise `/\evil.example`
 * into a protocol-relative URL.
 */
export function postLoginTarget(search: string): string {
  const raw = new URLSearchParams(search).get("next");
  if (!raw || !raw.startsWith("/")) return DEFAULT_AFTER_LOGIN;
  if (/^\/[/\\]/.test(raw)) return DEFAULT_AFTER_LOGIN;
  // Bouncing back to an auth route would loop the operator through login again.
  if (/^\/(login|register)(\/|\?|$)/.test(raw)) return DEFAULT_AFTER_LOGIN;
  return raw;
}

export function Link({
  to,
  onClick,
  ...props
}: Omit<React.ComponentPropsWithoutRef<"a">, "href"> & { to: string }) {
  return (
    <a
      {...props}
      href={to}
      onClick={(event) => {
        onClick?.(event);
        // Only intercept plain left-clicks; modifier keys (cmd/ctrl/shift/alt)
        // and the middle/right buttons keep the browser's default
        // open-in-new-tab/window behaviour.
        if (
          !event.defaultPrevented &&
          event.button === 0 &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.shiftKey &&
          !event.altKey
        ) {
          event.preventDefault();
          navigate(to);
        }
      }}
    />
  );
}
