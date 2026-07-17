import type { Permission, Principal, Role } from "./rbac";

export type ApiSuccess<T> = {
  ok: true;
  data: T;
};

export type ApiFailure = {
  ok: false;
  error: {
    code: string;
    message: string;
  };
};

export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

export type Profile = {
  id: string;
  displayName: string;
  title: string;
  createdAt: string;
};

export type StoredFile = {
  key: string;
  filename: string;
  contentType: string;
  size: number;
  uploadedBy: string;
  createdAt: string;
};

export type SessionPayload = {
  principal: Principal;
  role: Role;
  permissions: readonly Permission[];
};

export type RuntimeConfig = {
  key: string;
  value: string;
};
