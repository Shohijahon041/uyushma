import { NextResponse, type NextRequest } from "next/server";
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  accessCookieOptions,
  apiUrl,
  isSameOrigin,
  refreshCookieOptions,
  type TokenPair,
} from "@/lib/server-api";

export const dynamic = "force-dynamic";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

type RefreshResult = TokenPair | null;
const refreshInFlight = new Map<string, Promise<RefreshResult>>();

async function rotateRefreshToken(refreshToken: string): Promise<RefreshResult> {
  const existing = refreshInFlight.get(refreshToken);
  if (existing) return existing;

  const job = (async (): Promise<RefreshResult> => {
    try {
      const response = await fetch(apiUrl("auth/refresh"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) return null;
      return (await response.json()) as TokenPair;
    } catch {
      return null;
    } finally {
      refreshInFlight.delete(refreshToken);
    }
  })();

  refreshInFlight.set(refreshToken, job);
  return job;
}

function copyResponseHeaders(upstream: Response): Headers {
  const headers = new Headers();
  const contentType = upstream.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  const contentDisposition = upstream.headers.get("content-disposition");
  if (contentDisposition) headers.set("content-disposition", contentDisposition);
  const contentLength = upstream.headers.get("content-length");
  if (contentLength) headers.set("content-length", contentLength);
  headers.set("cache-control", "private, no-store");
  headers.set("x-content-type-options", "nosniff");
  return headers;
}

async function handle(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  if (UNSAFE_METHODS.has(request.method) && !isSameOrigin(request)) {
    return NextResponse.json(
      { message: "So'rov manbasi ruxsat etilmagan" },
      { status: 403 },
    );
  }

  const { path } = await context.params;
  if (!path?.length || path.some((segment) => !segment || segment.includes(".."))) {
    return NextResponse.json({ message: "Yo'l noto'g'ri" }, { status: 400 });
  }
  const safePath = path.map((segment) => encodeURIComponent(segment)).join("/");
  const target = apiUrl(`${safePath}${request.nextUrl.search}`);

  const rawBody =
    request.method === "GET" || request.method === "HEAD"
      ? undefined
      : await request.arrayBuffer();
  const body = rawBody && rawBody.byteLength > 0 ? rawBody : undefined;

  const baseHeaders = new Headers();
  const contentType = request.headers.get("content-type");
  if (contentType) baseHeaders.set("content-type", contentType);
  const idempotencyKey = request.headers.get("idempotency-key");
  if (idempotencyKey) baseHeaders.set("idempotency-key", idempotencyKey);

  const send = async (accessToken?: string): Promise<Response> => {
    const headers = new Headers(baseHeaders);
    if (accessToken) headers.set("authorization", `Bearer ${accessToken}`);
    return fetch(target, {
      method: request.method,
      headers,
      ...(body !== undefined ? { body } : {}),
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
  };

  let accessToken = request.cookies.get(ACCESS_COOKIE)?.value;
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;

  let upstream: Response;
  try {
    upstream = await send(accessToken);
  } catch {
    return NextResponse.json(
      { message: "API bilan aloqa o'rnatilmadi" },
      { status: 502 },
    );
  }

  let rotated: TokenPair | null = null;
  if (upstream.status === 401 && refreshToken) {
    rotated = await rotateRefreshToken(refreshToken);
    if (rotated) {
      accessToken = rotated.accessToken;
      try {
        upstream = await send(accessToken);
      } catch {
        return NextResponse.json(
          { message: "API bilan aloqa o'rnatilmadi" },
          { status: 502 },
        );
      }
    }
  }

  const responseBody = upstream.status === 204 ? null : await upstream.arrayBuffer();
  const response = new NextResponse(responseBody, {
    status: upstream.status,
    headers: copyResponseHeaders(upstream),
  });

  if (rotated) {
    response.cookies.set(
      ACCESS_COOKIE,
      rotated.accessToken,
      accessCookieOptions(rotated.accessTokenExpiresIn),
    );
    response.cookies.set(
      REFRESH_COOKIE,
      rotated.refreshToken,
      refreshCookieOptions(rotated.refreshTokenExpiresIn),
    );
  } else if (upstream.status === 401) {
    response.cookies.set(ACCESS_COOKIE, "", { path: "/", maxAge: 0 });
    response.cookies.set(REFRESH_COOKIE, "", { path: "/", maxAge: 0 });
  }

  return response;
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;
