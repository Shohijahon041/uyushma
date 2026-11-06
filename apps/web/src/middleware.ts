import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "./i18n/routing";

const intlMiddleware = createMiddleware(routing);

function firstHeaderValue(value: string | null): string | null {
  const first = value?.split(",")[0]?.trim();
  return first ? first : null;
}

// Next.js standalone builds absolute redirect URLs from its bound host
// (localhost:PORT), ignoring the inbound Host header. Behind nginx that leaks
// the internal address to the browser, so rewrite those redirects using the
// forwarded public origin.
function fixRedirectOrigin(response: NextResponse, request: NextRequest) {
  if (response.status < 300 || response.status >= 400) return response;

  const location = response.headers.get("location");
  if (!location) return response;

  let target: URL;
  try {
    target = new URL(location);
  } catch {
    return response;
  }

  if (!/^(localhost|127\.0\.0\.1|\[::1\])$/i.test(target.hostname)) return response;

  const host = firstHeaderValue(request.headers.get("x-forwarded-host")) ?? request.headers.get("host");
  if (!host) return response;

  const proto =
    firstHeaderValue(request.headers.get("x-forwarded-proto")) ??
    request.nextUrl.protocol.replace(":", "");

  response.headers.set("location", `${proto}://${host}${target.pathname}${target.search}${target.hash}`);
  return response;
}

export default function middleware(request: NextRequest) {
  return fixRedirectOrigin(intlMiddleware(request), request);
}

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
