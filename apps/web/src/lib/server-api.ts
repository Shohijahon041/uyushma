const API_BASE = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";

export const ACCESS_COOKIE = "uy_at";
export const REFRESH_COOKIE = "uy_rt";

const secure = process.env.SESSION_COOKIE_SECURE === "true";

export function accessCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge,
  };
}

export function refreshCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge,
  };
}

export function apiUrl(path: string): string {
  return `${API_BASE.replace(/\/$/, "")}/api/v1/${path.replace(/^\//, "")}`;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
  refreshTokenExpiresIn: number;
}

export function setSessionCookies<T extends TokenPair>(
  response: import("next/server").NextResponse,
  tokens: T,
): import("next/server").NextResponse {
  response.cookies.set(
    ACCESS_COOKIE,
    tokens.accessToken,
    accessCookieOptions(tokens.accessTokenExpiresIn),
  );
  response.cookies.set(
    REFRESH_COOKIE,
    tokens.refreshToken,
    refreshCookieOptions(tokens.refreshTokenExpiresIn),
  );
  return response;
}

export async function apiFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(apiUrl(path), {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
}

export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const originHost = new URL(origin).host;
    const forwardedHost = request.headers
      .get("x-forwarded-host")
      ?.split(",")[0]
      .trim();
    const host = forwardedHost || request.headers.get("host");
    return originHost === (host ?? new URL(request.url).host);
  } catch {
    return false;
  }
}

export function extractApiMessage(payload: unknown): string {
  if (payload && typeof payload === "object" && "message" in payload) {
    const message = (payload as { message?: unknown }).message;
    if (Array.isArray(message)) return message.join(", ");
    if (typeof message === "string") return message;
  }
  return "Xatolik yuz berdi";
}
