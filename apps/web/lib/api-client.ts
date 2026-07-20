"use client";

function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: any,
  ) {
    super(body?.message || `Request failed with status ${status}`);
  }
}

async function request<T>(path: string, options: RequestInit = {}, retry = true): Promise<T> {
  const method = (options.method || "GET").toUpperCase();
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type") && options.body && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const csrf = getCookie("csrf_token");
    if (csrf) headers.set("x-csrf-token", csrf);
  }

  const res = await fetch(`/api${path}`, { ...options, headers, credentials: "same-origin" });

  // A 401 here just means "not currently authenticated" — it's the normal
  // response for an unauthenticated /auth/me probe, not necessarily an
  // expired session. Try a silent refresh once; if that also fails, throw
  // and let the caller (route guards in AdminShell/AgentShell, or the
  // AuthProvider itself) decide what to do via client-side navigation.
  // A hard `window.location` redirect here would reload the page and can
  // race with the very probe that triggered it, looping forever.
  if (res.status === 401 && retry && path !== "/auth/refresh" && path !== "/auth/login") {
    const refreshed = await fetch("/api/auth/refresh", {
      method: "POST",
      credentials: "same-origin",
      headers: getCookie("csrf_token") ? { "x-csrf-token": getCookie("csrf_token") as string } : undefined,
    });
    if (refreshed.ok) {
      return request<T>(path, options, false);
    }
    throw new ApiError(401, { message: "Not authenticated" });
  }

  const contentType = res.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  const body = isJson ? await res.json().catch(() => null) : await res.blob();

  if (!res.ok) {
    throw new ApiError(res.status, body);
  }
  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: "GET" }),
  post: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: "POST", body: data !== undefined ? JSON.stringify(data) : undefined }),
  put: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: "PUT", body: data !== undefined ? JSON.stringify(data) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  postForm: <T>(path: string, formData: FormData) => request<T>(path, { method: "POST", body: formData }),
};

export async function downloadFile(path: string, filename: string): Promise<void> {
  const csrf = getCookie("csrf_token");
  const res = await fetch(`/api${path}`, {
    credentials: "same-origin",
    headers: csrf ? { "x-csrf-token": csrf } : undefined,
  });
  if (!res.ok) {
    let message = `Export failed with status ${res.status}`;
    try {
      const body = await res.json();
      message = body?.message || message;
    } catch {
      // response wasn't JSON — keep the generic status message
    }
    window.alert(message);
    throw new ApiError(res.status, { message });
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
