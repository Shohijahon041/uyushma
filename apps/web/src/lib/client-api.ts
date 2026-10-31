export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function parseError(response: Response): Promise<never> {
  let message = `Xatolik (${response.status})`;
  try {
    const payload = (await response.json()) as { message?: string | string[] };
    message = Array.isArray(payload.message)
      ? payload.message.join(", ")
      : payload.message ?? message;
  } catch {
    // no JSON body
  }
  if (response.status === 401) {
    const locale =
      typeof document !== "undefined"
        ? document.documentElement.lang || "uz"
        : "uz";
    if (typeof window !== "undefined") {
      window.location.href = `/${locale}/login`;
    }
  }
  throw new ApiClientError(response.status, message);
}

export async function apiRequest<T>(
  path: string,
  options: {
    method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): Promise<T> {
  const response = await fetch(`/api/proxy/${path.replace(/^\//, "")}`, {
    method: options.method ?? "GET",
    credentials: "same-origin",
    headers: {
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(options.headers ?? {}),
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    cache: "no-store",
  });
  if (!response.ok) {
    await parseError(response);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export interface SessionUser {
  user: { fullName: string };
  company: { name: string; isPlatform: boolean };
}

export type SessionLoginResult =
  | SessionUser
  | { mfaRequired: true; mfaToken: string; expiresIn: number };

export async function sessionLogin(payload: {
  phone: string;
  password: string;
}): Promise<SessionLoginResult> {
  const response = await fetch("/api/session/login", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) await parseError(response);
  return response.json();
}

export async function sessionVerifyTwoFactor(payload: {
  mfaToken: string;
  code?: string;
  recoveryCode?: string;
}): Promise<SessionUser> {
  const response = await fetch("/api/session/2fa/verify", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) await parseError(response);
  return response.json();
}

export async function sessionLogout(): Promise<void> {
  await fetch("/api/session/logout", {
    method: "POST",
    credentials: "same-origin",
  });
}
