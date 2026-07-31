import { describe, expect, it } from "vitest";
import {
  authEndpoints,
  type EndpointRequest,
  type EndpointResponse,
} from "../src/api";
import { ADMINISTRATOR_PERMISSIONS } from "../src/domain";

describe("authentication endpoint contracts", () => {
  it("declares the current login, logout, refresh, session, email, and password routes", () => {
    expect(authEndpoints.login.method).toBe("POST");
    expect(authEndpoints.login.path).toBe("/auth/login");
    expect(authEndpoints.logout).toMatchObject({ method: "POST", path: "/auth/logout" });
    expect(authEndpoints.refresh).toMatchObject({ method: "POST", path: "/auth/refresh" });
    expect(authEndpoints.session).toMatchObject({ method: "GET", path: "/auth/session" });
    expect(authEndpoints.email).toMatchObject({ method: "POST", path: "/auth/email" });
    expect(authEndpoints.passwordReset).toMatchObject({
      method: "POST",
      path: "/auth/password/reset",
    });
  });

  it("parses the login token response and complete session permission array", () => {
    const login: EndpointResponse<typeof authEndpoints.login> =
      authEndpoints.login.responses[200].parse({
        accessToken: "access-token",
        accessTokenExpiresIn: 900,
        refreshTokenExpiresAt: "2099-01-01T00:00:00.000Z",
      });
    expect(login.accessToken).toBe("access-token");

    const session: EndpointResponse<typeof authEndpoints.session> =
      authEndpoints.session.responses[200].parse({
        userId: "user-1",
        email: "admin@example.com",
        permissions: [...ADMINISTRATOR_PERMISSIONS],
      });
    expect(session.permissions).toEqual([...ADMINISTRATOR_PERMISSIONS]);
  });

  it("validates every authenticated request body", () => {
    const login: EndpointRequest<typeof authEndpoints.login> = {
      body: { email: "OPERATOR@example.com", password: "correct horse battery staple" },
    };
    expect(authEndpoints.login.request?.body?.parse(login.body)).toMatchObject({
      email: "operator@example.com",
    });

    expect(
      authEndpoints.email.request?.body?.parse({
        currentPassword: "correct horse battery staple",
        email: "new@example.com",
      }),
    ).toEqual({
      currentPassword: "correct horse battery staple",
      email: "new@example.com",
    });
    expect(
      authEndpoints.passwordReset.request?.body?.parse({
        currentPassword: "correct horse battery staple",
        newPassword: "a different correct horse battery staple",
      }),
    ).toEqual({
      currentPassword: "correct horse battery staple",
      newPassword: "a different correct horse battery staple",
    });
  });

  it("accepts the Worker email-change response without inventing a user ID", () => {
    expect(
      authEndpoints.email.responses[200].parse({
        email: "new@example.com",
        sessionsRevoked: true,
      }),
    ).toEqual({ email: "new@example.com", sessionsRevoked: true });
  });
});
