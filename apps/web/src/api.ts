import type { ApiResult, Profile, Role, SessionPayload, StoredFile } from "@cf-startup/shared";
import { API_BASE_URL_STORAGE_KEY } from "./setup";

const DEFAULT_API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8787";

type RequestOptions = {
  role: Role;
  userId: string;
};

async function request<T>(
  path: string,
  options: RequestOptions,
  init: RequestInit = {}
): Promise<ApiResult<T>> {
  const headers = new Headers(init.headers);
  headers.set("x-user-role", options.role);
  headers.set("x-user-id", options.userId);

  if (init.body && !(init.body instanceof FormData)) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    headers
  });

  return (await response.json()) as ApiResult<T>;
}

export function getApiBaseUrl(): string {
  if (typeof window === "undefined") {
    return DEFAULT_API_BASE_URL;
  }

  return window.localStorage.getItem(API_BASE_URL_STORAGE_KEY) || DEFAULT_API_BASE_URL;
}

export const api = {
  session: (options: RequestOptions) => request<SessionPayload>("/session", options),
  profiles: (options: RequestOptions) => request<Profile[]>("/profiles", options),
  createProfile: (options: RequestOptions, body: { displayName: string; title: string }) =>
    request<Profile>("/profiles", options, {
      method: "POST",
      body: JSON.stringify(body)
    }),
  files: (options: RequestOptions) => request<StoredFile[]>("/files", options),
  uploadFile: (options: RequestOptions, file: File) => {
    const form = new FormData();
    form.set("file", file);
    return request<StoredFile>("/files", options, {
      method: "POST",
      body: form
    });
  },
  setConfig: (options: RequestOptions, key: string, value: string) =>
    request<{ key: string; value: string }>(`/config/${encodeURIComponent(key)}`, options, {
      method: "PUT",
      body: JSON.stringify({ value })
    })
};
