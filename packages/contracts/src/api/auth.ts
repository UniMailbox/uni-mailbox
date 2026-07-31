import { z } from "zod";
import { PERMISSION_KEYS, type PermissionKey } from "../domain";
import { defineEndpoint } from "./common/endpoint";

const EmailSchema = z.string().trim().email().transform((value) => value.toLowerCase());
const PasswordSchema = z.string().min(12).max(1024);

export const LoginSchema = z.object({
  email: EmailSchema,
  password: PasswordSchema,
});

export const RegisterSchema = LoginSchema.extend({
  displayName: z.string().trim().min(1).max(120),
  registrationKey: z.string().trim().min(8).max(255).optional(),
});

const TokenResponseSchema = z.object({
  accessToken: z.string().min(1),
  accessTokenExpiresIn: z.number().int().positive(),
  refreshTokenExpiresAt: z.string().datetime(),
});

const SessionProfileSchema = z.object({
  userId: z.string().min(1),
  email: EmailSchema,
  permissions: z.array(z.enum(PERMISSION_KEYS)),
});

export type SessionProfile = z.output<typeof SessionProfileSchema>;

export const authEndpoints = {
  login: defineEndpoint({
    method: "POST",
    path: "/auth/login",
    request: { body: LoginSchema },
    responses: { 200: TokenResponseSchema },
    errors: ["AUTH_CREDENTIALS_INVALID", "LOGIN_RATE_LIMITED", "BOOTSTRAP_INCOMPLETE"],
    mediaType: "json",
  }),
  logout: defineEndpoint({
    method: "POST",
    path: "/auth/logout",
    responses: { 200: z.object({ revoked: z.boolean() }) },
    errors: [],
    mediaType: "json",
  }),
  refresh: defineEndpoint({
    method: "POST",
    path: "/auth/refresh",
    responses: { 200: TokenResponseSchema },
    errors: ["REFRESH_TOKEN_REQUIRED", "REFRESH_TOKEN_INVALID", "REFRESH_TOKEN_REUSED"],
    mediaType: "json",
  }),
  session: defineEndpoint({
    method: "GET",
    path: "/auth/session",
    responses: { 200: SessionProfileSchema },
    errors: ["AUTH_REQUIRED", "AUTH_TOKEN_INVALID", "BOOTSTRAP_INCOMPLETE"],
    mediaType: "json",
  }),
  email: defineEndpoint({
    // The Worker currently exposes this as POST. Keep that wire contract while
    // routing/form migration is in flight rather than changing server behavior.
    method: "POST",
    path: "/auth/email",
    request: { body: z.object({ currentPassword: PasswordSchema, email: EmailSchema }) },
    responses: { 200: z.object({ userId: z.string(), email: EmailSchema, sessionsRevoked: z.literal(true) }) },
    errors: ["AUTH_CREDENTIALS_INVALID", "USER_EMAIL_CONFLICT", "AUTH_REQUIRED"],
    mediaType: "json",
  }),
  passwordReset: defineEndpoint({
    method: "POST",
    path: "/auth/password/reset",
    request: { body: z.object({ currentPassword: PasswordSchema, newPassword: PasswordSchema }) },
    responses: { 200: z.object({ reset: z.literal(true), sessionsRevoked: z.literal(true) }) },
    errors: ["AUTH_CREDENTIALS_INVALID", "AUTH_REQUIRED"],
    mediaType: "json",
  }),
} as const;

export type AuthSessionProfile = {
  userId: string;
  email: string;
  permissions: PermissionKey[];
};
