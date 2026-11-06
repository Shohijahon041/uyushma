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

const inFlightGets = new Map<string, Promise<unknown>>();
const getCache = new Map<string, { data: unknown; expiresAt: number }>();
const CACHE_TTL_MS = 30_000; // 30 soniyalik xotira keshi — sahifalar o'rtasida takroriy so'rovlarni va kutishni oldini oladi

export function getCachedApiData<T>(path: string): T | undefined {
  const cleanPath = path.replace(/^\//, "");
  const cached = getCache.get(cleanPath);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data as T;
  }
  if (cleanPath === "auth/me" && typeof window !== "undefined") {
    try {
      const stored = sessionStorage.getItem("uyushma_me");
      if (stored) {
        const parsed = JSON.parse(stored) as T;
        getCache.set(cleanPath, { data: parsed, expiresAt: Date.now() + CACHE_TTL_MS });
        return parsed;
      }
    } catch {
      // ignore
    }
  }
  return undefined;
}

export function invalidateApiCache(prefix?: string): void {
  if (!prefix) {
    getCache.clear();
    return;
  }
  for (const key of getCache.keys()) {
    if (key.startsWith(prefix) || key.includes(prefix)) {
      getCache.delete(key);
    }
  }
}

export async function apiRequest<T>(
  path: string,
  options: {
    method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
    body?: unknown;
    headers?: Record<string, string>;
    bypassCache?: boolean;
  } = {},
): Promise<T> {
  const method = options.method ?? "GET";
  const cleanPath = path.replace(/^\//, "");

  // Faqat GET so'rovlari uchun kesh va so'rov birlashtirish (deduplication)
  if (method === "GET") {
    if (!options.bypassCache) {
      const cached = getCache.get(cleanPath);
      if (cached && Date.now() < cached.expiresAt) {
        return cached.data as T;
      }
    }

    const inFlight = inFlightGets.get(cleanPath);
    if (inFlight && !options.bypassCache) {
      return inFlight as Promise<T>;
    }
  } else {
    // Ma'lumot o'zgartiruvchi so'rovlarda keshni tozalash
    invalidateApiCache();
  }

  const execute = async (): Promise<T> => {
    const response = await fetch(`/api/proxy/${cleanPath}`, {
      method,
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
    const rawText = await response.text();
    if (!rawText.trim()) return undefined as T;
    let data: T;
    try {
      data = JSON.parse(rawText) as T;
    } catch {
      return undefined as T;
    }

    if (method === "GET") {
      getCache.set(cleanPath, { data, expiresAt: Date.now() + CACHE_TTL_MS });
      if (cleanPath === "auth/me" && typeof window !== "undefined") {
        try {
          sessionStorage.setItem("uyushma_me", JSON.stringify(data));
        } catch {
          // ignore
        }
      }
    }
    return data;
  };

  if (method === "GET") {
    const job = execute().finally(() => {
      inFlightGets.delete(cleanPath);
    });
    inFlightGets.set(cleanPath, job);
    return job;
  }

  return execute();
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
  const result = (await response.json()) as SessionLoginResult;
  if (!("mfaRequired" in result)) clearSessionCache();
  return result;
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
  const result = (await response.json()) as SessionUser;
  clearSessionCache();
  return result;
}

export function clearSessionCache(): void {
  if (typeof window !== "undefined") {
    try {
      sessionStorage.removeItem("uyushma_me");
    } catch {
      // ignore
    }
  }
  invalidateApiCache();
}

export async function sessionLogout(): Promise<void> {
  clearSessionCache();
  await fetch("/api/session/logout", {
    method: "POST",
    credentials: "same-origin",
  });
}
