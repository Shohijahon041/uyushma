const STATUS_HINTS: Record<number, string> = {
  400: "So'rov parametrlari tashqi tizim tomonidan rad etildi",
  401: "Token yaroqsiz yoki muddati tugagan — tokenni yangilang",
  403: "Bu token uchun ruxsat yo'q",
  404: "Endpoint topilmadi — integratsiya manzilini tekshiring",
  429: "Tashqi tizim so'rovlar chegarasini qo'lladi, keyinroq urinib ko'ring",
  500: "Tashqi tizim ichki xatosi",
  502: "Tashqi tizim javob bermadi",
  503: "Tashqi tizim vaqtincha ishlamayapti",
};

export class ExternalHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ExternalHttpError";
  }
}

function providerMessage(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as { message?: unknown; error?: unknown };
    if (typeof parsed.message === "string" && parsed.message.trim()) {
      return parsed.message.trim().slice(0, 300);
    }
    if (typeof parsed.error === "string" && parsed.error.trim()) {
      return parsed.error.trim().slice(0, 300);
    }
  } catch {
    // not JSON
  }
  return null;
}

/** 401/403 mean the stored token died — retrying other endpoints is pointless. */
export function isExternalAuthError(error: unknown): boolean {
  return (
    error instanceof ExternalHttpError &&
    (error.status === 401 || error.status === 403)
  );
}

export async function externalRequestJson(
  url: string,
  options: {
    token?: string;
    method?: "GET" | "POST" | "PUT";
    body?: unknown;
    timeoutMs?: number;
    userAgent?: string;
  },
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? "GET",
      headers: {
        Accept: "application/json",
        ...(options.token
          ? { Authorization: `Bearer ${options.token}` }
          : {}),
        ...(options.body !== undefined
          ? { "Content-Type": "application/json" }
          : {}),
        "User-Agent":
          options.userAgent ?? "Uyushmachilar/1.0 (registry sync)",
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
      redirect: "follow",
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ExternalHttpError(
      0,
      `Tashqi tizimga ulanib bo'lmadi: ${reason}`,
    );
  }

  const raw = await response.text();
  if (!response.ok) {
    const hint = STATUS_HINTS[response.status] ?? "Tashqi tizim xatosi";
    const detail = providerMessage(raw);
    throw new ExternalHttpError(
      response.status,
      `${hint} (HTTP ${response.status})${detail ? `: ${detail}` : ""}`,
    );
  }
  if (!raw.trim()) return null;
  const contentType = response.headers.get("content-type") ?? "";
  if (
    contentType.includes("text/html") ||
    raw.trim().startsWith("<!doctype") ||
    raw.trim().startsWith("<html")
  ) {
    throw new ExternalHttpError(
      response.status,
      "Tashqi tizim web sahifa (HTML) qaytardi. API endpoint manzili yoki sessiya tokeni eskirgan bo'lishi mumkin",
    );
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new ExternalHttpError(
      response.status,
      "Tashqi tizim JSON o'rniga boshqa format qaytardi",
    );
  }
}
