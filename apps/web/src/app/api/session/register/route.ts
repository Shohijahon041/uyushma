import { NextResponse } from "next/server";
import {
  apiFetch,
  extractApiMessage,
  isSameOrigin,
  setSessionCookies,
  type TokenPair,
} from "@/lib/server-api";

interface RegisterResponse extends TokenPair {
  user: unknown;
  company: unknown;
}

type RegisterPayload =
  | RegisterResponse
  | { verificationRequired: true; user: unknown; company: unknown };

export async function POST(request: Request): Promise<NextResponse> {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ message: "So'rov manbasi ruxsat etilmagan" }, { status: 403 });
  }
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > 10_000) {
    return NextResponse.json({ message: "So'rov hajmi juda katta" }, { status: 413 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "JSON yaroqsiz" }, { status: 400 });
  }

  try {
    const upstream = await apiFetch("auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await upstream.json()) as RegisterPayload & { message?: unknown };
    if (!upstream.ok) {
      return NextResponse.json(
        { message: extractApiMessage(payload) },
        { status: upstream.status },
      );
    }
    if ("verificationRequired" in payload) {
      return NextResponse.json({
        verificationRequired: true,
        user: payload.user,
        company: payload.company,
      });
    }

    return setSessionCookies(
      NextResponse.json({
        user: payload.user,
        company: payload.company,
      }),
      payload,
    );
  } catch {
    return NextResponse.json(
      { message: "API bilan aloqa o'rnatilmadi. Keyinroq urinib ko'ring." },
      { status: 503 },
    );
  }
}
