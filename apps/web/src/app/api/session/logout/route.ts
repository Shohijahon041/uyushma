import { NextResponse } from "next/server";
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  apiFetch,
  isSameOrigin,
} from "@/lib/server-api";

export async function POST(request: Request): Promise<NextResponse> {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ message: "So'rov manbasi ruxsat etilmagan" }, { status: 403 });
  }
  const refreshToken = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${REFRESH_COOKIE}=`))
    ?.split("=")
    .slice(1)
    .join("=");

  if (refreshToken) {
    try {
      await apiFetch("auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: decodeURIComponent(refreshToken) }),
      });
    } catch {
      // Local session is cleared regardless; the refresh token will expire.
    }
  }

  const response = new NextResponse(null, { status: 204 });
  response.cookies.set(ACCESS_COOKIE, "", { path: "/", maxAge: 0 });
  response.cookies.set(REFRESH_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}
