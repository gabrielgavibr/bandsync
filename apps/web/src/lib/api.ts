import type { ApiErrorCode } from "@bandsync/shared";

export class ApiError extends Error {
  readonly code: ApiErrorCode | "network";
  readonly status: number;
  readonly details: unknown;
  constructor(code: ApiErrorCode | "network", status: number, message?: string, details?: unknown) {
    super(message ?? code);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

type Listener = () => void;
const unauthorizedListeners = new Set<Listener>();
/** Lets the auth layer react globally when a session expires. */
export function onUnauthorized(fn: Listener): () => void {
  unauthorizedListeners.add(fn);
  return () => unauthorizedListeners.delete(fn);
}

export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown; signal?: AbortSignal; formData?: FormData } = {},
): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  let body: BodyInit | undefined;
  if (init.formData) body = init.formData;
  else if (init.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(init.body);
  }
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? "GET",
      headers,
      body,
      credentials: "same-origin",
      signal: init.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError("network", 0, "network error");
  }
  if (res.status === 204) return undefined as T;
  let json: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  if (!res.ok) {
    const e = (
      json as { error?: { code?: ApiErrorCode; message?: string; details?: unknown } } | null
    )?.error;
    const code = e?.code ?? (res.status === 401 ? "unauthorized" : "internal_error");
    if (code === "unauthorized" && !path.startsWith("/api/auth/"))
      for (const fn of unauthorizedListeners) fn();
    throw new ApiError(code, res.status, e?.message, e?.details);
  }
  return json as T;
}

export const http = {
  get: <T>(path: string, signal?: AbortSignal) => api<T>(path, { signal }),
  post: <T>(path: string, body?: unknown) => api<T>(path, { method: "POST", body }),
  patch: <T>(path: string, body?: unknown) => api<T>(path, { method: "PATCH", body }),
  put: <T>(path: string, body?: unknown) => api<T>(path, { method: "PUT", body }),
  delete: <T>(path: string) => api<T>(path, { method: "DELETE" }),
  upload: <T>(path: string, formData: FormData) => api<T>(path, { method: "POST", formData }),
};

/** Translate an unknown error into a stable code for the UI to localise. */
export function errorCode(err: unknown): ApiErrorCode | "network" {
  if (err instanceof ApiError) return err.code;
  return "internal_error";
}
