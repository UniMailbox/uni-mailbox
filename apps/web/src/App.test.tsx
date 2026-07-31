import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ADMINISTRATOR_PERMISSIONS } from "@unimailbox/contracts";
import { App } from "./App";

function renderApp() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  );
}

function ok(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function denied(code: string, status: number): Response {
  return new Response(
    JSON.stringify({
      error: { code, message: `stubbed ${code}`, requestId: "test-request" },
    }),
    { status, headers: { "content-type": "application/json" } },
  );
}

/**
 * Route stubbed responses by the path that follows `/api/v1`. Anything not
 * listed resolves to an empty collection, so a test only has to describe the
 * endpoints it cares about — and `calls` proves which endpoints the app chose
 * to hit, which is how we assert that a guard blocked a request entirely.
 */
function stubApi(routes: Record<string, () => Response>) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input).replace(/^.*\/api\/v1/u, "");
      calls.push(`${init?.method ?? "GET"} ${path}`);
      const handler = routes[path];
      return handler ? handler() : ok([]);
    }),
  );
  return calls;
}

const ADMIN_SESSION = {
  userId: "user-1",
  email: "admin@example.com",
  permissions: [...ADMINISTRATOR_PERMISSIONS],
};

const MEMBER_SESSION = {
  userId: "user-2",
  email: "member@example.com",
  permissions: ["message.read", "message.send"],
};

/**
 * Every route the guard should refuse to an anonymous visitor, paired with the
 * `?next=` the login URL should carry. `/inbox` is the post-login default, so
 * remembering it explicitly would only add noise to the most common entry.
 */
const PROTECTED_ROUTES: Array<[route: string, expectedSearch: string]> = [
  ["/inbox", ""],
  ["/sent", "?next=%2Fsent"],
  ["/drafts", "?next=%2Fdrafts"],
  ["/starred", "?next=%2Fstarred"],
  ["/archive", "?next=%2Farchive"],
  ["/trash", "?next=%2Ftrash"],
  ["/settings/account", "?next=%2Fsettings%2Faccount"],
  ["/settings/mailboxes", "?next=%2Fsettings%2Fmailboxes"],
  ["/admin/users", "?next=%2Fadmin%2Fusers"],
  ["/admin/analytics", "?next=%2Fadmin%2Fanalytics"],
  [
    "/messages/00000000-0000-0000-0000-000000000001",
    "?next=%2Fmessages%2F00000000-0000-0000-0000-000000000001",
  ],
];

describe("UniMailbox application boundary", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the secure operator login route", async () => {
    stubApi({ "/auth/session": () => denied("AUTH_REQUIRED", 401) });
    window.history.replaceState({}, "", "/login");
    renderApp();

    expect(
      await screen.findByRole("heading", {
        name: "Sign in to your mail plane.",
      }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Email address")).toHaveAttribute(
      "autocomplete",
      "email",
    );
    expect(
      screen.getByRole("button", { name: /Enter workspace/ }),
    ).toBeVisible();
  });

  it("redirects the removed setup route to login", async () => {
    stubApi({ "/auth/session": () => denied("AUTH_REQUIRED", 401) });
    window.history.replaceState({}, "", "/setup");
    renderApp();

    await waitFor(() => expect(window.location.pathname).toBe("/login"));
    expect(
      await screen.findByRole("heading", {
        name: "Sign in to your mail plane.",
      }),
    ).toBeVisible();
    expect(screen.queryByText(/installation token/i)).not.toBeInTheDocument();
  });
});

describe("route protection", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(PROTECTED_ROUTES)(
    "sends an anonymous visitor from %s to login",
    async (route, expectedSearch) => {
      const calls = stubApi({
        "/auth/session": () => denied("AUTH_REQUIRED", 401),
        "/auth/refresh": () => denied("REFRESH_TOKEN_REQUIRED", 401),
      });
      window.history.replaceState({}, "", route);
      renderApp();

      await waitFor(() => expect(window.location.pathname).toBe("/login"));
      // The deep link is preserved so the operator resumes where they aimed.
      expect(window.location.search).toBe(expectedSearch);
      // The guard must block before any protected data request is issued;
      // otherwise the dashboard leaks a burst of doomed 401s on every visit.
      expect(
        calls.filter(
          (call) => !call.includes("/auth/session") && !call.includes("/auth/"),
        ),
      ).toEqual([]);
    },
  );

  it("replaces rather than pushes the login redirect", async () => {
    stubApi({
      "/auth/session": () => denied("AUTH_REQUIRED", 401),
      "/auth/refresh": () => denied("REFRESH_TOKEN_REQUIRED", 401),
    });
    window.history.replaceState({}, "", "/inbox");
    const lengthBefore = window.history.length;
    renderApp();

    await waitFor(() => expect(window.location.pathname).toBe("/login"));
    // A pushed entry would let Back bounce straight into the denied route.
    expect(window.history.length).toBe(lengthBefore);
  });

  it("lets an authenticated administrator into the workspace", async () => {
    const calls = stubApi({
      "/auth/session": () => ok(ADMIN_SESSION),
      "/mailboxes": () =>
        ok([
          { id: "mailbox-1", address: "ops@example.com", display_name: "Ops" },
        ]),
    });
    window.history.replaceState({}, "", "/inbox");
    renderApp();

    expect(
      await screen.findByRole("button", { name: /Compose/ }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe("/inbox");
    expect(calls).toContain("GET /mailboxes");
  });

  it("shows the administration entry point to an administrator", async () => {
    stubApi({
      "/auth/session": () => ok(ADMIN_SESSION),
      "/mailboxes": () => ok([]),
    });
    window.history.replaceState({}, "", "/inbox");
    renderApp();

    expect(
      await screen.findByRole("link", { name: /Administration/ }),
    ).toBeInTheDocument();
  });

  it("hides the administration entry point from a plain member", async () => {
    stubApi({
      "/auth/session": () => ok(MEMBER_SESSION),
      "/mailboxes": () => ok([]),
    });
    window.history.replaceState({}, "", "/inbox");
    renderApp();

    // Wait for the workspace itself before asserting the absence, so this
    // cannot pass merely because the shell had not rendered yet.
    await screen.findByRole("link", { name: /Settings/ });
    expect(
      screen.queryByRole("link", { name: /Administration/ }),
    ).not.toBeInTheDocument();
  });

  it("refuses the admin console to a member without redirecting to login", async () => {
    const calls = stubApi({
      "/auth/session": () => ok(MEMBER_SESSION),
    });
    window.history.replaceState({}, "", "/admin/users");
    renderApp();

    expect(
      await screen.findByText(/do not have access to this area/i),
    ).toBeInTheDocument();
    // Still signed in: sending them to /login would be misleading.
    expect(window.location.pathname).toBe("/admin/users");
    expect(screen.getByText("user.read")).toBeInTheDocument();
    expect(calls).not.toContain("GET /admin/users");
  });

  it("gates each admin resource on the permission its Worker route asserts", async () => {
    stubApi({
      // Holds only the analytics read permission: /admin/analytics is allowed,
      // /admin/users is not.
      "/auth/session": () =>
        ok({ ...MEMBER_SESSION, permissions: ["analytics.read"] }),
    });
    window.history.replaceState({}, "", "/admin/analytics");
    renderApp();

    await waitFor(() =>
      expect(
        screen.queryByText(/do not have access to this area/i),
      ).not.toBeInTheDocument(),
    );
    expect(window.location.pathname).toBe("/admin/analytics");
  });

  it("surfaces a server fault instead of masking it as a login redirect", async () => {
    stubApi({
      "/auth/session": () => denied("BOOTSTRAP_INCOMPLETE", 503),
    });
    window.history.replaceState({}, "", "/inbox");
    renderApp();

    expect(await screen.findByText(/did not complete/i)).toBeInTheDocument();
    // A 503 is not "signed out" — bouncing to /login would hide the outage.
    expect(window.location.pathname).toBe("/inbox");
  });

  it("keeps a signed-in operator away from the login form", async () => {
    stubApi({
      "/auth/session": () => ok(ADMIN_SESSION),
      "/mailboxes": () => ok([]),
    });
    window.history.replaceState({}, "", "/login");
    renderApp();

    await waitFor(() => expect(window.location.pathname).toBe("/inbox"));
    expect(
      screen.queryByRole("heading", { name: "Sign in to your mail plane." }),
    ).not.toBeInTheDocument();
  });

  it("honours the saved next target when a signed-in operator hits login", async () => {
    stubApi({
      "/auth/session": () => ok(ADMIN_SESSION),
    });
    window.history.replaceState(
      {},
      "",
      `/login?next=${encodeURIComponent("/admin/roles")}`,
    );
    renderApp();

    await waitFor(() => expect(window.location.pathname).toBe("/admin/roles"));
  });

  it("ignores an off-site next target", async () => {
    stubApi({
      "/auth/session": () => ok(ADMIN_SESSION),
      "/mailboxes": () => ok([]),
    });
    window.history.replaceState(
      {},
      "",
      `/login?next=${encodeURIComponent("https://evil.example/steal")}`,
    );
    renderApp();

    // An absolute or protocol-relative target must never win: it would carry a
    // freshly minted session off-origin.
    await waitFor(() => expect(window.location.pathname).toBe("/inbox"));
    expect(window.location.host).toBe("localhost:3000");
  });
});
