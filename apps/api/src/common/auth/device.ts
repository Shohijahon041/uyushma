export interface ClientMeta {
  userAgent?: string | null;
  ip?: string | null;
}

export function deviceLabel(userAgent: string | null | undefined): string {
  if (!userAgent) return "Noma'lum qurilma";
  const ua = userAgent.toLowerCase();
  const browser = ua.includes("edg/")
    ? "Edge"
    : ua.includes("opr/") || ua.includes("opera")
      ? "Opera"
      : ua.includes("chrome/") && !ua.includes("chromium")
        ? "Chrome"
        : ua.includes("firefox/")
          ? "Firefox"
          : ua.includes("safari/")
            ? "Safari"
            : "Brauzer";
  const os = ua.includes("iphone") || ua.includes("ipad")
    ? "iOS"
    : ua.includes("android")
      ? "Android"
      : ua.includes("windows")
        ? "Windows"
        : ua.includes("mac os")
          ? "macOS"
          : ua.includes("linux")
            ? "Linux"
            : "Qurilma";
  return `${browser} · ${os}`;
}

export function clientMeta(userAgent?: string | null, ip?: string | null): ClientMeta {
  return {
    userAgent: userAgent ? userAgent.slice(0, 512) : null,
    ip: ip ?? null,
  };
}
