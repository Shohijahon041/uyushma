"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { apiRequest } from "@/lib/client-api";
import { formatDateTime, useApi } from "@/lib/use-api";
import type {
  ExternalConnection,
  ExternalProviderKey,
  ExternalSyncRun,
} from "@/lib/types";
import { Alert, StatusBadge } from "@/components/ui";

interface ProviderMeta {
  key: ExternalProviderKey;
  titleKey: string;
  hintKey: string;
  url: string;
  domain: string;
  icon: string;
  badge: string;
  features: string[];
}

const PROVIDERS: ProviderMeta[] = [
  {
    key: "ETENDER",
    titleKey: "providerEtender",
    hintKey: "providerEtenderHint",
    url: "https://e-tender.uztrans.uz",
    domain: "e-tender.uztrans.uz",
    icon: "🚛",
    badge: "Transport vazirligi",
    features: [
      "Litsenziyalar va guvohnomalar",
      "Tender arizalari va holatlari",
      "Shartnomalar va yo'nalishlar",
      "Avtomobillar ro'yxati",
    ],
  },
  {
    key: "AUTOPARK",
    titleKey: "providerAutopark",
    hintKey: "providerAutoparkHint",
    url: "https://bm.dtransport.uz",
    domain: "bm.dtransport.uz",
    icon: "🚌",
    badge: "Toshkent shahar / Avtopark",
    features: [
      "Yo'nalishlar daraxti (Route Tree)",
      "Avtobuslar, garaj raqami va GPS IMEI",
      "Haydovchilar (JSHSHIR, toifalar)",
      "Kunlik navbatchiliklar",
    ],
  },
  {
    key: "IJARA",
    titleKey: "providerIjara",
    hintKey: "providerIjaraHint",
    url: "https://ijara.soliq.uz",
    domain: "ijara.soliq.uz",
    icon: "📑",
    badge: "Davlat Soliq Qo'mitasi",
    features: [
      "Avtomobil ijara shartnomalari",
      "Ijaraga beruvchi va oluvchi ma'lumotlari",
      "Oylik ijara to'lovi miqdori",
      "Shartnoma muddatlari va holatlari",
    ],
  },
];

const SSO_URLS: Record<string, string> = {
  ETENDER:
    "https://sso.egov.uz/sso/oauth/Authorization.do?response_type=one_code&client_id=e-tender_uztrans_uz&redirect_uri=https://e-tender.uztrans.uz&scope=e-tender_uztrans_uz&state=e-tender_uztrans_uz",
  AUTOPARK:
    "https://sso.egov.uz/sso/oauth/Authorization.do?response_type=one_code&client_id=bm_dtransport_uz&redirect_uri=https://bm.dtransport.uz/login/oneid&scope=myportal&state=testState",
};

function badgeStatus(status: ExternalConnection["status"]): string {
  if (status === "INVALID") return "FAILED";
  if (status === "DISABLED") return "INACTIVE";
  return "ACTIVE";
}

function cleanTokenInput(raw: string): string {
  const trimmed = raw.trim();
  // Agar JSON nusxalangan bo'lsa
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      const found =
        obj.token ??
        obj.access_token ??
        obj.accessToken ??
        (obj.data && typeof obj.data === "object" ? (obj.data as Record<string, unknown>).token ?? (obj.data as Record<string, unknown>).access_token : undefined);
      if (typeof found === "string") return found.trim();
    } catch {
      // ignore
    }
  }
  const match = trimmed.match(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/);
  if (match) return match[0];
  return trimmed
    .replace(/^Bearer\s+/i, "")
    .replace(/^["'`]|["'`]$/g, "")
    .replace(/\r?\n|\r/g, "")
    .trim();
}

function extractCodeFromInput(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.includes("?")) {
    try {
      const url = new URL(trimmed.startsWith("http") ? trimmed : `https://example.com/${trimmed}`);
      const code = url.searchParams.get("one_code") ?? url.searchParams.get("code");
      if (code) return code.trim();
    } catch {
      // fallback
    }
  }
  const match = trimmed.match(/[?&](?:one_code|code)=([^&#\s]+)/i);
  if (match && match[1]) {
    return decodeURIComponent(match[1]).trim();
  }
  return trimmed;
}

function launchConnector(code: string) {
  window.location.href = `uyushma://connect/${encodeURIComponent(code)}`;
}

function launchDiagnostics() {
  window.location.href = "uyushma://diagnose";
}

function LocalConnectorPanel({
  code,
  expiresAt,
  providerLabel,
  onOpen,
}: {
  code: string;
  expiresAt: string | null;
  providerLabel: string;
  onOpen?: () => void;
}) {
  const [openAttempted, setOpenAttempted] = useState(false);

  return (
    <div className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50/70 p-3.5 text-xs space-y-2.5">
      <p className="font-bold text-indigo-950">💻 Kompyuteringizdagi brauzer orqali ulash</p>

      <button
        type="button"
        onClick={() => {
          setOpenAttempted(true);
          if (onOpen) onOpen();
          else launchConnector(code);
        }}
        className="btn-primary inline-flex w-full items-center justify-center gap-2 bg-indigo-600 px-4 py-2.5 text-sm font-bold shadow-sm hover:bg-indigo-700 sm:w-auto"
      >
        <span>▶</span>
        <span>Ulagich oynasini ochish</span>
      </button>

      {openAttempted && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900">
          Oyna ochilmadimi? Demak bu kompyuterda ulagich hali o&apos;rnatilmagan.{" "}
          <a
            href="/uyushma-ulagich.bat"
            download
            className="font-bold underline hover:text-amber-950"
          >
            Uyushma-ulagich.bat
          </a>{" "}
          faylini yuklab oling va bir marta ishga tushiring.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px]">
        <a
          href="/uyushma-ulagich-yoriqnoma.html"
          target="_blank"
          rel="noreferrer"
          className="font-bold text-indigo-700 underline hover:text-indigo-900"
        >
          Yo&apos;riqnoma (batafsil qo&apos;llanma)
        </a>
        <button
          type="button"
          onClick={launchDiagnostics}
          className="font-semibold text-indigo-700 underline hover:text-indigo-900"
        >
          Holatni tekshirish
        </button>
      </div>
      <p className="text-[10px] leading-relaxed text-indigo-500">
        Log: %LOCALAPPDATA%\UyushmaUlagich\ulagich.log
      </p>
      <p className="text-[10px] leading-relaxed text-indigo-600">
        Tugmalar javob bermasa (Windows protokolni bloklagan bo&apos;lsa), ish stolidagi{" "}
        <strong>«Uyushma bilan ulash»</strong> yorlig&apos;ini ochib, quyidagi kodni kiriting. Birinchi
        ishga tushirishda Windows administrator ruxsatini so&apos;rasa — <strong>«Ha»</strong> ni bosing.
      </p>

      <ol className="list-decimal pl-4 space-y-1 text-[11px] text-indigo-900">
        <li>
          <strong>Birinchi marta:</strong>{" "}
          <a
            href="/uyushma-ulagich.bat"
            download
            className="font-bold text-indigo-700 underline hover:text-indigo-900"
          >
            Uyushma-ulagich.bat
          </a>{" "}
          faylini yuklab oling va ishga tushiring. Windows ogohlantirsa:{" "}
          <strong>More info → Run anyway</strong>. Shu bilan kompyuterga bir marta o&apos;rnatiladi.
        </li>
        <li>
          Keyingi safar hech narsa yuklab olish shart emas — yuqoridagi{" "}
          <strong>«Ulagich oynasini ochish»</strong> tugmasini bosing.
        </li>
        <li>
          Brauzer <strong>«Uyushma ulagichni ochish»</strong> deb so&apos;rasa:{" "}
          <strong>«Ochish»</strong> ni tanlang va <strong>«Har doim ruxsat berish»</strong> ni
          belgilang.
        </li>
        <li>
          Ochilgan Chrome oynasida <strong>{providerLabel}</strong> ga kiring. Token avtomatik
          saqlanadi va oyna o&apos;zi yopiladi.
        </li>
      </ol>

      <details className="rounded-lg border border-indigo-200 bg-white/70 px-3 py-2">
        <summary className="cursor-pointer text-[11px] font-semibold text-indigo-800">
          Oyna ochilmadimi? Qo&apos;lda kod bilan ulash
        </summary>
        <p className="mt-1.5 text-[11px] text-indigo-900">
          <strong>Uyushma-ulagich.bat</strong> faylini ishga tushiring va quyidagi kodni kiriting:{" "}
          <span className="font-mono text-base font-bold tracking-[0.2em]">{code}</span>
        </p>
      </details>

      <p className="text-[10px] text-indigo-600">
        Kod amal qiladi: {expiresAt ? formatDateTime(expiresAt) : "10 daqiqa"}.
      </p>
    </div>
  );
}

function ProviderCard({
  meta,
  connection,
  onChanged,
}: {
  meta: ProviderMeta;
  connection?: ExternalConnection;
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const [mode, setMode] = useState<"sso" | "login" | "token">(
    meta.key === "IJARA" ? "login" : "sso",
  );
  const [token, setToken] = useState("");
  const [ssoCode, setSsoCode] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [ip, setIp] = useState("");
  const [busy, setBusy] = useState<"save" | "sync" | "disable" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pairing, setPairing] = useState<{ code: string; expiresAt: string } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(
    () => () => {
      if (pollRef.current) clearInterval(pollRef.current);
    },
    [],
  );

  const cleanedToken = cleanTokenInput(token);
  const canSave =
    mode === "sso"
      ? ssoCode.trim().length >= 3
      : mode === "login"
        ? username.trim().length >= 3 && password.length >= 4
        : cleanedToken.length >= 10;

  function handleTokenPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const pasted = e.clipboardData.getData("text");
    if (pasted) {
      e.preventDefault();
      setToken(cleanTokenInput(pasted));
    }
  }

  function handleCleanTokenClick() {
    if (token) {
      setToken(cleanTokenInput(token));
      setMessage("Token tozalandi (Bearer prefiksi va ortiqcha belgilar olib tashlandi)");
      setTimeout(() => setMessage(null), 3000);
    }
  }

  async function handleLocalConnector() {
    setError(null);
    setMessage(null);
    setBusy("save");
    try {
      const res = await apiRequest<{ code: string; expiresAt: string }>(
        `/settings/integrations/${meta.key}/browser-pairing`,
        { method: "POST" },
      );
      setPairing({ code: res.code, expiresAt: res.expiresAt });
      if (pollRef.current) clearInterval(pollRef.current);
      const startedAt = Date.now();
      pollRef.current = setInterval(() => {
        if (Date.now() - startedAt > 10 * 60_000) {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          return;
        }
        void onChanged();
      }, 5000);
      // O'rnatilgan ulagichni darhol ochishga harakat qilamiz.
      window.setTimeout(() => launchConnector(res.code), 150);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kod olishda xatolik");
    } finally {
      setBusy(null);
    }
  }

  async function handleSsoSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setBusy("save");
    try {
      const code = extractCodeFromInput(ssoCode);
      const res = await apiRequest<{ success: boolean; account?: string }>(
        `/settings/integrations/${meta.key}/oneid-exchange`,
        {
          method: "POST",
          body: { code },
        },
      );
      setSsoCode("");
      setMessage(`OneID orqali muvaffaqiyatli ulandi! ${res.account ? `(${res.account})` : ""}`);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : tc("error"));
    } finally {
      setBusy(null);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setBusy("save");
    try {
      const body =
        mode === "login"
          ? {
              credentials: {
                username: username.trim(),
                password,
                ...(meta.key === "ETENDER" && ip.trim() ? { ip: ip.trim() } : {}),
              },
            }
          : { token: cleanedToken };
      await apiRequest(`/settings/integrations/${meta.key}`, {
        method: "PUT",
        body,
      });
      setToken("");
      setUsername("");
      setPassword("");
      setIp("");
      setMessage(t(mode === "login" ? "credentialsSaved" : "integrationSaved"));
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : tc("error"));
    } finally {
      setBusy(null);
    }
  }

  async function syncNow() {
    setError(null);
    setMessage(null);
    setBusy("sync");
    try {
      await apiRequest(`/settings/integrations/${meta.key}/sync`, {
        method: "POST",
        body: {},
      });
      setMessage(t("syncQueued"));
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : tc("error"));
    } finally {
      setBusy(null);
    }
  }

  async function disable() {
    if (!window.confirm("Rostdan ham ushbu ulanishni butunlay o'chirmoqchimisiz?")) return;
    setError(null);
    setMessage(null);
    setBusy("disable");
    try {
      await apiRequest(`/settings/integrations/${meta.key}`, {
        method: "DELETE",
      });
      setMessage("Ulanish muvaffaqiyatli o'chirildi");
      await onChanged();
      setTimeout(() => setMessage(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : tc("error"));
    } finally {
      setBusy(null);
    }
  }

  const isAuthError = !!(
    connection?.status === "INVALID" ||
    (connection?.lastError &&
      (connection.lastError.includes("401") ||
        connection.lastError.includes("muddati tugagan") ||
        connection.lastError.includes("yaroqsiz")))
  );
  const isConnected = connection?.status === "ACTIVE" && !isAuthError;

  return (
    <div
      className={`card flex flex-col justify-between border transition-all ${
        isConnected
          ? "border-emerald-200 bg-white shadow-sm ring-1 ring-emerald-100"
          : isAuthError
            ? "border-rose-200 bg-white shadow-sm ring-1 ring-rose-100"
            : "border-slate-200 bg-white shadow-sm"
      }`}
    >
      <div className="card-body">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-2xl shadow-inner">
              {meta.icon}
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-900">{t(meta.titleKey)}</h3>
                <a
                  href={meta.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-brand-600 hover:text-brand-700 hover:underline"
                  title="Rasmiy portalni yangi oynada ochish"
                >
                  ↗
                </a>
              </div>
              <p className="mt-0.5 text-xs text-slate-500">{meta.badge}</p>
            </div>
          </div>
          <div className="shrink-0">
            <StatusBadge
              status={isAuthError ? "FAILED" : badgeStatus(connection?.status ?? "DISABLED")}
              label={
                isAuthError
                  ? "Token muddati tugagan"
                  : isConnected
                    ? t("connected")
                    : t("disconnected")
              }
            />
          </div>
        </div>

        {/* Feature list pills */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {meta.features.map((feat) => (
            <span
              key={feat}
              className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600"
            >
              ✓ {feat}
            </span>
          ))}
        </div>

        {/* Connection info */}
        <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50/70 p-3 text-xs space-y-2">
          {connection?.account && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-slate-500 font-medium">🏢 {t("organization")}:</span>
              <span className="font-semibold text-slate-800 text-right truncate max-w-[200px]" title={connection.account}>
                {connection.account}
              </span>
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <span className="text-slate-500 font-medium">🕒 {t("lastSync")}:</span>
            <span className="font-medium text-slate-700">
              {connection?.lastSyncAt ? formatDateTime(connection.lastSyncAt) : t("neverSynced")}
            </span>
          </div>
          {connection?.authMode && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-slate-500 font-medium">🔐 Ulanish usuli:</span>
              <span className="font-semibold text-slate-700">
                {connection.authMode === "LOGIN" ? "OneID Login/Parol" : "Bearer Token"}
              </span>
            </div>
          )}
          {connection?.lastError && (
            <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50/80 p-2.5 text-[11px] leading-relaxed text-rose-800">
              <span className="font-bold">Oxirgi xatolik:</span> {connection.lastError}
            </div>
          )}
        </div>

        {error && (
          <div className="mt-3">
            <Alert tone="error">{error}</Alert>
          </div>
        )}
        {message && (
          <div className="mt-3">
            <Alert tone="success">{message}</Alert>
          </div>
        )}
        {pairing && (
          <LocalConnectorPanel
            code={pairing.code}
            expiresAt={pairing.expiresAt}
            providerLabel={meta.domain}
          />
        )}

        {/* IJARA uchun ulanish va demo yuklash bloki */}
        {meta.key === "IJARA" && (
          <div className="mt-4 rounded-xl border border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50 p-3.5 space-y-2.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold text-blue-950">📑 Soliq Ijara (ijara.soliq.uz) Integratsiyasi</p>
                <p className="mt-0.5 text-[11px] text-blue-700 leading-tight">
                  Davlat Soliq Qo&apos;mitasidan avtomobil ijara shartnomalari, to&apos;lovlar va haydovchilar
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  className="btn-primary bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 text-xs font-semibold shadow-xs inline-flex items-center gap-1"
                  onClick={() => void handleLocalConnector()}
                  disabled={busy !== null}
                  title="Kompyuteringizda Chrome oynasini ochadi va E-IMZO bilan kirgach tokenni avtomatik saqlaydi"
                >
                  <span>💻 Kompyuterda ulash</span>
                </button>
              </div>
            </div>
            {isAuthError && (
              <div className="rounded-lg border border-rose-300 bg-rose-50 p-2 text-[11px] text-rose-800">
                <strong>Diqqat:</strong> Oldingi tokeningiz eskirgan (HTTP 401).{" "}
                <strong>&quot;Kompyuterda ulash&quot;</strong> tugmasidan foydalanib qayta ulang.
              </div>
            )}
          </div>
        )}

        {/* Mode switch */}
        <div className="mt-4 flex items-center justify-between">
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5 text-xs">
            {meta.key !== "IJARA" && (
              <button
                type="button"
                className={`rounded-md px-2.5 py-1.5 font-medium transition-all ${
                  mode === "sso"
                    ? "bg-white font-bold text-slate-900 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
                onClick={() => setMode("sso")}
              >
                ⚡ OneID SSO
              </button>
            )}
            <button
              type="button"
              className={`rounded-md px-2.5 py-1.5 font-medium transition-all ${
                mode === "login"
                  ? "bg-white font-bold text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
              onClick={() => setMode("login")}
            >
              🔑 {t("loginMode")}
            </button>
            <button
              type="button"
              className={`rounded-md px-2.5 py-1.5 font-medium transition-all ${
                mode === "token"
                  ? "bg-white font-bold text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
              onClick={() => setMode("token")}
            >
              🎫 {t("tokenMode")}
            </button>
          </div>

          <button
            type="button"
            className="text-[11px] font-semibold text-brand-600 hover:text-brand-800 hover:underline"
            onClick={() => setShowGuide((prev) => !prev)}
          >
            {showGuide ? "▲ Yashirish" : "💡 Yo'riqnoma"}
          </button>
        </div>

        {/* Token olish yo'riqnomasi */}
        {showGuide && (
          <div className="mt-3 rounded-xl border border-brand-200 bg-brand-50/50 p-3 text-xs text-slate-700 space-y-2">
            <p className="font-bold text-brand-900">
              💡 {meta.domain} dan tokenni olish tartibi:
            </p>
            <ol className="list-decimal pl-4 space-y-1 text-[11px] text-slate-600">
              <li>
                Brauzerda yangi oynada{" "}
                <a
                  href={meta.url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-bold text-brand-600 hover:underline"
                >
                  {meta.domain}
                </a>{" "}
                sahifasiga kiring va OneID orqali kiring.
              </li>
              <li>
                Klaviaturada <kbd className="rounded border bg-white px-1 py-0.5 font-mono text-[10px]">F12</kbd>{" "}
                tugmasini bosing va <strong>Network (Tarmoq)</strong> bo'limini tanlang.
              </li>
              <li>
                Sahifani yangilang va ro'yxatdagi istalgan <code className="font-mono text-[10px] bg-white px-1">api</code> so'rovi ustiga bosing.
              </li>
              <li>
                <strong>Headers</strong> bo'limidan <strong>Authorization: Bearer eyJ...</strong> qiymatini nusxalang va "Token" bo'limiga qo'ying.
              </li>
            </ol>
          </div>
        )}

        {/* Input Form */}
        {mode === "sso" && meta.key !== "IJARA" ? (
          <form onSubmit={handleSsoSubmit} className="mt-3 space-y-3">
            <div className="rounded-xl border border-purple-200 bg-purple-50/70 p-3 text-xs space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold text-purple-900">1-qadam: Rasmiy OneID orqali kiring</span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    className="btn-secondary bg-white hover:bg-purple-100 text-purple-700 border-purple-300 px-2.5 py-1 text-xs font-semibold shadow-2xs inline-flex items-center gap-1"
                    onClick={() => void handleLocalConnector()}
                    disabled={busy !== null}
                    title="Kompyuteringizda Chrome oynasini ochadi va kirgach tokenni avtomatik saqlaydi"
                  >
                    <span>💻 Kompyuterda ulash</span>
                  </button>
                  {SSO_URLS[meta.key] && (
                    <a
                      href={SSO_URLS[meta.key]}
                      target="_blank"
                      rel="noreferrer"
                      className="btn-primary bg-purple-600 hover:bg-purple-700 px-3 py-1 text-xs font-semibold shadow-xs inline-flex items-center gap-1"
                    >
                      <span>↗ OneID oynasi</span>
                    </a>
                  )}
                </div>
              </div>
              <p className="text-[11px] text-purple-800 leading-relaxed">
                Tugmani bosib OneID tizimida kiring. Kirgandan keyin brauzer manzil satridagi URL manzilni (masalan: <code className="bg-white/80 px-1 py-0.5 rounded font-mono">https://.../?{meta.key === "ETENDER" ? "one_code=" : "code="}...</code>) nusxalab pastdagi maydonga qo&apos;ying.
              </p>
            </div>

            <div>
              <label className="label text-xs font-semibold text-slate-700" htmlFor={`sso-code-${meta.key}`}>
                2-qadam: Qaytgan URL manzil yoki OneID kodi
              </label>
              <input
                id={`sso-code-${meta.key}`}
                type="text"
                className="input text-sm"
                placeholder={meta.key === "ETENDER" ? "https://e-tender.uztrans.uz/?one_code=48a9... yoki kod" : "https://bm.dtransport.uz/login/oneid?code=... yoki kod"}
                value={ssoCode}
                onChange={(e) => setSsoCode(e.target.value)}
                required
                minLength={3}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="submit"
                className="btn-primary px-4 py-2 text-xs font-bold"
                disabled={!canSave || busy !== null}
              >
                {busy === "save" ? tc("loading") : "⚡ Kodni tokenga aylantirish va ulanish"}
              </button>
              {connection && (
                <>
                  <button
                    type="button"
                    className="btn-secondary px-3.5 py-2 text-xs font-medium"
                    onClick={() => void syncNow()}
                    disabled={busy !== null}
                  >
                    {busy === "sync" ? t("syncing") : "🔄 " + t("syncNow")}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary border-red-200 px-3.5 py-2 text-xs font-medium text-red-600 hover:bg-red-50 hover:border-red-300"
                    onClick={() => void disable()}
                    disabled={busy !== null}
                  >
                    {t("disconnect")}
                  </button>
                </>
              )}
            </div>
          </form>
        ) : (
          <form onSubmit={save} className="mt-3 space-y-3">
            {mode === "login" ? (
              <>
                <div>
                  <label className="label text-xs font-semibold text-slate-700" htmlFor={`username-${meta.key}`}>
                    {meta.key === "ETENDER"
                      ? "INN yoki Login"
                      : meta.key === "AUTOPARK"
                        ? "bm.dtransport.uz Logini"
                        : "One ID / Soliq Logini"}
                  </label>
                  <input
                    id={`username-${meta.key}`}
                    type="text"
                    className="input text-sm"
                    autoComplete="username"
                    placeholder={meta.key === "ETENDER" ? "313054621" : "login"}
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    minLength={3}
                    required
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <label className="label text-xs font-semibold text-slate-700" htmlFor={`password-${meta.key}`}>
                      Parol
                    </label>
                    <button
                      type="button"
                      className="text-[11px] text-slate-500 hover:text-slate-800"
                      onClick={() => setShowPassword((p) => !p)}
                    >
                      {showPassword ? "Yashirish" : "Ko'rsatish"}
                    </button>
                  </div>
                  <input
                    id={`password-${meta.key}`}
                    type={showPassword ? "text" : "password"}
                    className="input text-sm"
                    autoComplete="current-password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    minLength={4}
                    required
                  />
                </div>

                {meta.key === "ETENDER" && (
                  <div>
                    <label className="label text-xs font-semibold text-slate-700" htmlFor={`ip-${meta.key}`}>
                      {t("ipOptional")} <span className="font-normal text-slate-400">(agar IP cheklovi bo'lsa)</span>
                    </label>
                    <input
                      id={`ip-${meta.key}`}
                      type="text"
                      className="input text-sm"
                      placeholder="185.139.136.25"
                      value={ip}
                      onChange={(event) => setIp(event.target.value)}
                    />
                  </div>
                )}
              </>
            ) : (
              <>
                <div>
                  <div className="flex items-center justify-between">
                    <label className="label text-xs font-semibold text-slate-700" htmlFor={`token-${meta.key}`}>
                      {t("accessToken")} (Bearer JWT)
                    </label>
                    {token && (
                      <button
                        type="button"
                        className="text-[11px] font-semibold text-brand-600 hover:underline"
                        onClick={handleCleanTokenClick}
                      >
                        ✨ Tozalash (Clean)
                      </button>
                    )}
                  </div>
                  <textarea
                    id={`token-${meta.key}`}
                    className="input font-mono text-xs leading-relaxed"
                    rows={4}
                    value={token}
                    onPaste={handleTokenPaste}
                    onChange={(event) => setToken(event.target.value)}
                    placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                    required
                  />
                  <p className="mt-1 text-[11px] text-slate-400">
                    Nusxalangan tokenni qo'ying. "Bearer " so'zi va ortiqcha bo'shliqlar avtomatik tozalanadi.
                  </p>
                </div>
              </>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-2">
              <button
                type="submit"
                className="btn-primary px-4 py-2 text-xs font-semibold"
                disabled={!canSave || busy !== null}
              >
                {busy === "save" ? tc("loading") : t("connect")}
              </button>
              {connection && (
                <>
                  <button
                    type="button"
                    className="btn-secondary px-3.5 py-2 text-xs font-medium"
                    onClick={() => void syncNow()}
                    disabled={busy !== null}
                  >
                    {busy === "sync" ? t("syncing") : "🔄 " + t("syncNow")}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary border-red-200 px-3.5 py-2 text-xs font-medium text-red-600 hover:bg-red-50 hover:border-red-300"
                    onClick={() => void disable()}
                    disabled={busy !== null}
                  >
                    {t("disconnect")}
                  </button>
                </>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

/**
 * Bitta OneID orqali portallarga ulanish markazi (SSO kod, kompyuter brauzeri yoki Login/Parol orqali)
 */
function OneIdUnifiedConnectCard({ onChanged }: { onChanged: () => Promise<void> }) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const [activeTab, setActiveTab] = useState<"sso" | "playwright" | "login">("sso");

  // SSO state
  const [ssoTarget, setSsoTarget] = useState<"ETENDER" | "AUTOPARK">("ETENDER");
  const [ssoInput, setSsoInput] = useState("");
  const [ssoBusy, setSsoBusy] = useState(false);
  const [ssoError, setSsoError] = useState<string | null>(null);
  const [ssoSuccess, setSsoSuccess] = useState<string | null>(null);

  // Kompyuter brauzeri (pairing) holati
  const [browserBusy, setBrowserBusy] = useState<"ETENDER" | "AUTOPARK" | null>(null);
  const [pairing, setPairing] = useState<{
    code: string;
    expiresAt: string;
    provider: "ETENDER" | "AUTOPARK";
  } | null>(null);
  const [browserError, setBrowserError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(
    () => () => {
      if (pollRef.current) clearInterval(pollRef.current);
    },
    [],
  );

  // Login/parol state
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [ip, setIp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    overallSuccess: boolean;
    providers: Record<string, { success: boolean; account?: string | null; error?: string }>;
  } | null>(null);

  function handleSsoInputChange(val: string) {
    setSsoInput(val);
    const lower = val.toLowerCase();
    if (lower.includes("e-tender") || lower.includes("one_code")) {
      setSsoTarget("ETENDER");
    } else if (lower.includes("dtransport") || lower.includes("bm") || lower.includes("myportal")) {
      setSsoTarget("AUTOPARK");
    }
  }

  async function handleSsoSubmit(e: FormEvent) {
    e.preventDefault();
    setSsoError(null);
    setSsoSuccess(null);
    setSsoBusy(true);
    try {
      const code = extractCodeFromInput(ssoInput);
      const res = await apiRequest<{ success: boolean; account?: string }>(
        `/settings/integrations/${ssoTarget}/oneid-exchange`,
        {
          method: "POST",
          body: { code },
        },
      );
      setSsoInput("");
      setSsoSuccess(
        `${ssoTarget === "ETENDER" ? "e-tender.uztrans.uz" : "bm.dtransport.uz"} ga OneID orqali muvaffaqiyatli ulandi! ${res.account ? `(${res.account})` : ""}`,
      );
      await onChanged();
    } catch (err) {
      setSsoError(err instanceof Error ? err.message : tc("error"));
    } finally {
      setSsoBusy(false);
    }
  }

  async function handleLaunchBrowser(target: "ETENDER" | "AUTOPARK") {
    setBrowserBusy(target);
    setBrowserError(null);
    setPairing(null);
    try {
      const res = await apiRequest<{ code: string; expiresAt: string }>(
        `/settings/integrations/${target}/browser-pairing`,
        { method: "POST" },
      );
      setPairing({ code: res.code, expiresAt: res.expiresAt, provider: target });
      if (pollRef.current) clearInterval(pollRef.current);
      const startedAt = Date.now();
      pollRef.current = setInterval(() => {
        if (Date.now() - startedAt > 10 * 60_000) {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          return;
        }
        void onChanged();
      }, 5000);
      // O'rnatilgan ulagichni darhol ochishga harakat qilamiz.
      window.setTimeout(() => launchConnector(res.code), 150);
    } catch (err) {
      setBrowserError(err instanceof Error ? err.message : tc("error"));
    } finally {
      setBrowserBusy(null);
    }
  }

  async function handleOneIdSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      const res = await apiRequest<{
        overallSuccess: boolean;
        providers: Record<string, { success: boolean; account?: string | null; error?: string }>;
      }>("/settings/integrations/oneid/connect-all", {
        method: "POST",
        body: {
          username: username.trim(),
          password,
          ...(ip.trim() ? { ip: ip.trim() } : {}),
        },
      });
      setResult(res);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : tc("error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card border-2 border-brand-300 bg-gradient-to-br from-brand-50/40 via-white to-slate-50 p-5 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-600 text-sm text-white font-bold shadow-sm">
              🔑
            </span>
            <h3 className="text-base font-bold text-slate-900">{t("oneIdConnectAllTitle")}</h3>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-slate-600 max-w-3xl">
            {t("oneIdConnectAllSubtitle")}
          </p>
        </div>

        {/* Tab switcher */}
        <div className="inline-flex rounded-lg border border-brand-200 bg-white p-1 text-xs shadow-2xs shrink-0 flex-wrap gap-1">
          <button
            type="button"
            className={`rounded-md px-3 py-1.5 font-bold transition-all ${
              activeTab === "sso"
                ? "bg-brand-600 text-white shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
            onClick={() => setActiveTab("sso")}
          >
            ⚡ Usul 1: SSO Kod
          </button>
          <button
            type="button"
            className={`rounded-md px-3 py-1.5 font-bold transition-all ${
              activeTab === "playwright"
                ? "bg-brand-600 text-white shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
            onClick={() => setActiveTab("playwright")}
          >
            💻 Usul 2: Kompyuter ulagichi
          </button>
          <button
            type="button"
            className={`rounded-md px-3 py-1.5 font-bold transition-all ${
              activeTab === "login"
                ? "bg-brand-600 text-white shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
            onClick={() => setActiveTab("login")}
          >
            🔑 Usul 3: Login va Parol
          </button>
        </div>
      </div>

      {activeTab === "sso" ? (
        <div className="mt-5 space-y-4">
          <div className="rounded-xl border border-purple-200 bg-purple-50/70 p-3.5 text-xs text-purple-900">
            <p className="font-bold">
              💡 Nima uchun OneID SSO eng ishonchli usul?
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-purple-800">
              OneID portalida ikki bosqichli tekshirish (SMS / E-IMZO) yoqilgan bo&apos;lsa, to&apos;g&apos;ridan-to&apos;g&apos;ri login-parol orqali kirib bo&apos;lmaydi. Quyidagi rasmiy tugmalar orqali OneID bilan tizimga kiring va brauzer manzil satridagi URL manzilni (yoki undagi kodni) nusxalab qo&apos;ying:
            </p>
          </div>

          {/* Quick SSO buttons */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800 text-xs">🚛 1. e-tender.uztrans.uz</span>
                  <span className="rounded-md bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">Transport Vazirligi</span>
                </div>
                <p className="mt-1 text-[11px] text-slate-500">
                  Litsenziyalar, tender arizalari, shartnomalar va guvohnomalar uchun.
                </p>
              </div>
              <div className="mt-3">
                <a
                  href={SSO_URLS.ETENDER}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-primary w-full bg-purple-600 hover:bg-purple-700 text-xs py-2 inline-flex items-center justify-center gap-1.5 shadow-2xs"
                  onClick={() => setSsoTarget("ETENDER")}
                >
                  <span>↗ OneID orqali e-tender ga kirish</span>
                </a>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800 text-xs">🚌 2. bm.dtransport.uz</span>
                  <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Toshkent Yo&apos;lovchi Transporti</span>
                </div>
                <p className="mt-1 text-[11px] text-slate-500">
                  Avtopark, avtobuslar, garaj raqamlari, GPS IMEI va haydovchilar uchun.
                </p>
              </div>
              <div className="mt-3">
                <a
                  href={SSO_URLS.AUTOPARK}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-primary w-full bg-purple-600 hover:bg-purple-700 text-xs py-2 inline-flex items-center justify-center gap-1.5 shadow-2xs"
                  onClick={() => setSsoTarget("AUTOPARK")}
                >
                  <span>↗ OneID orqali bm.dtransport ga kirish</span>
                </a>
              </div>
            </div>
          </div>

          {/* Unified code paste form */}
          <form onSubmit={handleSsoSubmit} className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <label className="text-xs font-bold text-slate-800" htmlFor="unified-sso-input">
                Kirgandan keyingi URL manzil yoki OneID kodi (one_code / code):
              </label>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-slate-500">Maqsad tizim:</span>
                <button
                  type="button"
                  className={`rounded-md px-2 py-1 text-xs font-semibold border ${
                    ssoTarget === "ETENDER"
                      ? "border-purple-600 bg-purple-50 text-purple-700"
                      : "border-slate-200 bg-slate-50 text-slate-600"
                  }`}
                  onClick={() => setSsoTarget("ETENDER")}
                >
                  🚛 e-tender
                </button>
                <button
                  type="button"
                  className={`rounded-md px-2 py-1 text-xs font-semibold border ${
                    ssoTarget === "AUTOPARK"
                      ? "border-purple-600 bg-purple-50 text-purple-700"
                      : "border-slate-200 bg-slate-50 text-slate-600"
                  }`}
                  onClick={() => setSsoTarget("AUTOPARK")}
                >
                  🚌 bm.dtransport
                </button>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <input
                id="unified-sso-input"
                type="text"
                className="input text-sm flex-1"
                placeholder={
                  ssoTarget === "ETENDER"
                    ? "https://e-tender.uztrans.uz/?one_code=48a9... yoki one_code"
                    : "https://bm.dtransport.uz/login/oneid?code=... yoki code"
                }
                value={ssoInput}
                onChange={(e) => handleSsoInputChange(e.target.value)}
                required
                minLength={3}
              />
              <button
                type="submit"
                className="btn-primary shrink-0 bg-brand-600 hover:bg-brand-700 px-5 py-2.5 text-xs font-bold shadow-sm"
                disabled={ssoBusy || ssoInput.trim().length < 3}
              >
                {ssoBusy ? "Ulanmoqda..." : "⚡ Kodni tokenga aylantirish va ulanish"}
              </button>
            </div>

            {ssoError && <Alert tone="error">{ssoError}</Alert>}
            {ssoSuccess && <Alert tone="success">{ssoSuccess}</Alert>}
          </form>
        </div>
      ) : activeTab === "playwright" ? (
        <div className="mt-5 space-y-4">
          <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 p-3.5 text-xs text-indigo-950 space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="font-bold text-indigo-900 text-sm">💻 Kompyuter ulagichi orqali ulash</span>
              <span className="rounded-md bg-indigo-200/80 px-2 py-0.5 text-[10px] font-bold text-indigo-800">Token avtomatik saqlanadi</span>
            </div>
            <p className="text-[11px] leading-relaxed text-indigo-800">
              Tugmani bosganingizda kompyuteringizda Chrome oynasi o&apos;zi ochiladi. Buning
              uchun <strong>Uyushma-ulagich.bat</strong> bir marta o&apos;rnatilgan bo&apos;lishi
              kerak. OneID bilan kirganingizdan so&apos;ng token avtomatik saqlanadi va oyna
              o&apos;zi yopiladi — har safar kod kiritish shart emas.
            </p>
          </div>

          {browserError && <Alert tone="error">{browserError}</Alert>}
          {pairing && (
            <LocalConnectorPanel
              code={pairing.code}
              expiresAt={pairing.expiresAt}
              providerLabel={
                pairing.provider === "ETENDER" ? "e-tender.uztrans.uz" : "bm.dtransport.uz"
              }
            />
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800 text-xs">🚛 e-tender.uztrans.uz</span>
                  <span className="rounded-md bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">Transport Vazirligi</span>
                </div>
                <p className="mt-1 text-[11px] text-slate-500">
                  Litsenziyalar, tenderlar va rasmiy guvohnomalar uchun OneID oynasini ochish.
                </p>
              </div>
              <div className="mt-4">
                <button
                  type="button"
                  className="btn-primary w-full bg-indigo-600 hover:bg-indigo-700 text-xs py-2.5 font-bold shadow-sm inline-flex items-center justify-center gap-2"
                  onClick={() => void handleLaunchBrowser("ETENDER")}
                  disabled={browserBusy !== null}
                >
                  <span>🌐</span>
                  <span>{browserBusy === "ETENDER" ? "Ulanish ochilmoqda..." : "Ulagich oynasini ochish"}</span>
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800 text-xs">🚌 bm.dtransport.uz</span>
                  <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Toshkent Avtopark</span>
                </div>
                <p className="mt-1 text-[11px] text-slate-500">
                  Avtobuslar, GPS IMEI va haydovchilar uchun OneID oynasi. Korxona
                  tanlash chiqsa, kerakli firmani (masalan, CAR LUX) tanlang.
                </p>
              </div>
              <div className="mt-4">
                <button
                  type="button"
                  className="btn-primary w-full bg-indigo-600 hover:bg-indigo-700 text-xs py-2.5 font-bold shadow-sm inline-flex items-center justify-center gap-2"
                  onClick={() => void handleLaunchBrowser("AUTOPARK")}
                  disabled={browserBusy !== null}
                >
                  <span>🌐</span>
                  <span>{browserBusy === "AUTOPARK" ? "Ulanish ochilmoqda..." : "Ulagich oynasini ochish"}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-5 space-y-4">
          {error && (
            <div>
              <Alert tone="error">{error}</Alert>
            </div>
          )}

          {result && (
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold text-slate-800">OneID orqali ulanish natijasi:</p>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                    result.overallSuccess
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-rose-100 text-rose-800"
                  }`}
                >
                  {result.overallSuccess ? "✓ Bajarildi" : "Xatoliklar mavjud"}
                </span>
              </div>

              <div className="grid gap-3 sm:grid-cols-3 pt-1">
                {Object.entries(result.providers).map(([providerKey, prov]) => (
                  <div
                    key={providerKey}
                    className={`rounded-xl border p-3 ${
                      prov.success
                        ? "border-emerald-200 bg-emerald-50/60"
                        : "border-rose-200 bg-rose-50/60"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-800 text-xs">
                        {providerKey === "ETENDER"
                          ? "🚛 e-tender.uztrans.uz"
                          : providerKey === "AUTOPARK"
                            ? "🚌 bm.dtransport.uz"
                            : "📑 ijara.soliq.uz"}
                      </span>
                      <span className="text-xs font-semibold">
                        {prov.success ? "✅ Ulangan" : "❌ Xatolik"}
                      </span>
                    </div>
                    {prov.account && (
                      <p className="mt-1 text-[11px] font-medium text-slate-700 truncate" title={prov.account}>
                        🏢 {prov.account}
                      </p>
                    )}
                    {prov.error && (
                      <p className="mt-1 text-[11px] text-rose-700 leading-tight">
                        {prov.error}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <form onSubmit={handleOneIdSubmit} className="grid gap-4 sm:grid-cols-4 items-end">
            <div>
              <label className="label text-xs font-semibold text-slate-700" htmlFor="oneid-login">
                One ID login (INN / JSHSHIR)
              </label>
              <input
                id="oneid-login"
                type="text"
                className="input text-sm bg-white"
                placeholder="313054621"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                minLength={3}
              />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <label className="label text-xs font-semibold text-slate-700" htmlFor="oneid-password">
                  One ID paroli
                </label>
                <button
                  type="button"
                  className="text-[11px] text-slate-500 hover:text-slate-800"
                  onClick={() => setShowPassword((p) => !p)}
                >
                  {showPassword ? "Yashirish" : "Ko'rsatish"}
                </button>
              </div>
              <input
                id="oneid-password"
                type={showPassword ? "text" : "password"}
                className="input text-sm bg-white"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={4}
              />
            </div>
            <div>
              <label className="label text-xs font-semibold text-slate-700" htmlFor="oneid-ip">
                Tashqi IP (Ixtiyoriy)
              </label>
              <input
                id="oneid-ip"
                type="text"
                className="input text-sm bg-white"
                placeholder="Masalan: 185.139.136.25"
                value={ip}
                onChange={(e) => setIp(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                className="btn-primary w-full py-2.5 text-xs font-bold shadow-sm"
                disabled={busy || username.trim().length < 3 || password.length < 4}
              >
                {busy ? t("oneIdConnecting") : "⚡ " + t("oneIdConnectAllButton")}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

export function ExternalSettings({ role }: { role: string }) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const [syncingAll, setSyncingAll] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const connections = useApi<{
    items: ExternalConnection[];
    labels: Record<ExternalProviderKey, string>;
  }>("/settings/integrations");
  const runs = useApi<{ items: ExternalSyncRun[] }>("/settings/integrations/runs");

  if (role !== "OWNER" && role !== "ADMIN") return null;

  const byProvider = new Map(
    (connections.data?.items ?? []).map((conn) => [conn.provider, conn]),
  );

  async function reloadAll() {
    await Promise.all([connections.reload(), runs.reload()]);
  }

  async function handleSyncAll() {
    setSyncingAll(true);
    setActionMessage(null);
    try {
      await apiRequest("/settings/integrations/sync-all", { method: "POST" });
      setActionMessage("Barcha faol tashqi tizimlarni sinxronlash navbatga qo'yildi!");
      await reloadAll();
      setTimeout(() => setActionMessage(null), 5000);
    } catch (err) {
      setActionMessage(err instanceof Error ? `Xatolik: ${err.message}` : "Sinxronlashda xatolik");
    } finally {
      setSyncingAll(false);
    }
  }

  return (
    <div className="card card-body w-full border border-slate-200 shadow-sm">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-slate-900">{t("integrations")}</h2>
            <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
              Rasmiy integratsiya
            </span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-slate-500 max-w-2xl">
            {t("integrationsDescription")}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <a
            href="/uyushma-ulagich.bat"
            download
            className="btn-secondary flex items-center gap-1.5 px-4 py-2 text-xs font-semibold"
          >
            <span>💻</span>
            <span>Ulagichni o&apos;rnatish (bir marta)</span>
          </a>
          <a
            href="/uyushma-ulagich-yoriqnoma.html"
            target="_blank"
            rel="noreferrer"
            className="btn-secondary flex items-center gap-1.5 px-4 py-2 text-xs font-semibold"
          >
            <span>📘</span>
            <span>Yo&apos;riqnoma</span>
          </a>
          <button
            type="button"
            className="btn-primary flex items-center gap-1.5 px-4 py-2 text-xs font-semibold shadow-sm"
            onClick={() => void handleSyncAll()}
            disabled={syncingAll}
          >
            <span>🔄</span>
            <span>{syncingAll ? "Sinxronlanmoqda..." : "Barchasini sinxronlash"}</span>
          </button>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50/60 px-4 py-3 text-[11px] leading-relaxed text-indigo-900">
        <p className="font-bold">💻 Kompyuter yordamchisi — bir marta o&apos;rnatiladi</p>
        <p className="mt-1">
          Yuqoridagi <strong>«Ulagichni o&apos;rnatish (bir marta)»</strong> faylini yuklab, bir
          marta ishga tushiring (Windows ogohlantirsa: <strong>More info → Run anyway</strong>).
          Shundan keyin istalgan portal kartasida <strong>«💻 Kompyuterda ulash»</strong> tugmasini
          bossangiz, Chrome oynasi o&apos;zi ochiladi — kod kiritish yoki faylni qayta yuklash shart
          emas. OneID / E-IMZO bilan kirganingizdan so&apos;ng token avtomatik saqlanadi.
        </p>
      </div>

      {actionMessage && (
        <div className="mt-4">
          <Alert tone="success">{actionMessage}</Alert>
        </div>
      )}

      {/* 1. Bitta OneID orqali ulanish markazi */}
      <div className="mt-5">
        <OneIdUnifiedConnectCard onChanged={reloadAll} />
      </div>

      {connections.error && (
        <div className="mt-4">
          <Alert tone="error">{connections.error}</Alert>
        </div>
      )}

      {/* 2. Provayderlar kartochkalari (e-tender, bm.dtransport, ijara.soliq) */}
      <div className="mt-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-slate-800">
            Alohida portallar bo'yicha ulanish va sozlamalar:
          </h3>
          <span className="text-xs text-slate-500">
            {connections.data?.items.filter((i) => i.status === "ACTIVE").length ?? 0} / 3 tizim faol
          </span>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {PROVIDERS.map((providerMeta) => (
            <ProviderCard
              key={providerMeta.key}
              meta={providerMeta}
              connection={byProvider.get(providerMeta.key)}
              onChanged={reloadAll}
            />
          ))}
        </div>
      </div>

      {/* 3. Sinxronlash jurnali */}
      <div className="mt-8 border-t border-slate-100 pt-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-800">{t("syncHistory")}</h3>
            <p className="text-xs text-slate-500">
              Tashqi tizimlardan olingan ma'lumotlar va sinxronlash holati
            </p>
          </div>
          <button
            type="button"
            className="text-xs font-medium text-brand-600 hover:underline"
            onClick={() => void runs.reload()}
          >
            Yangilash
          </button>
        </div>

        {runs.error ? (
          <div className="mt-3">
            <Alert tone="error">{runs.error}</Alert>
          </div>
        ) : runs.data?.items.length ? (
          <div className="table-wrap mt-3">
            <table className="table w-full">
              <thead>
                <tr>
                  <th className="w-48">{t("provider")}</th>
                  <th className="w-32">{tc("status")}</th>
                  <th>{t("syncedRecords")}</th>
                  <th className="w-44">{t("startedAt")}</th>
                </tr>
              </thead>
              <tbody>
                {runs.data.items.map((run) => (
                  <tr key={run.id} className="hover:bg-slate-50/80 transition-colors">
                    <td>
                      <span className="inline-flex items-center gap-1.5 font-semibold text-slate-800 text-xs">
                        <span>
                          {run.provider === "ETENDER"
                            ? "🚛"
                            : run.provider === "AUTOPARK"
                              ? "🚌"
                              : "📑"}
                        </span>
                        <span>
                          {run.provider === "ETENDER"
                            ? "e-tender.uztrans.uz"
                            : run.provider === "AUTOPARK"
                              ? "bm.dtransport.uz"
                              : "ijara.soliq.uz"}
                        </span>
                      </span>
                    </td>
                    <td>
                      <StatusBadge
                        status={run.status}
                        label={t(
                          run.status === "SUCCESS"
                            ? "runSuccess"
                            : run.status === "RUNNING"
                              ? "runRunning"
                              : "runFailed",
                        )}
                      />
                    </td>
                    <td className="text-xs text-slate-600">
                      {run.counts ? (
                        <div className="flex flex-wrap items-center gap-1.5">
                          {typeof run.counts.vehicles === "number" && run.counts.vehicles > 0 && (
                            <span className="rounded-md bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
                              🚛 {run.counts.vehicles} avtomobil
                              {typeof run.counts.created === "number" && run.counts.created > 0 && (
                                <strong className="ml-1 text-emerald-600">(+{run.counts.created} yangi)</strong>
                              )}
                            </span>
                          )}
                          {typeof run.counts.routes === "number" && run.counts.routes > 0 && (
                            <span className="rounded-md bg-blue-50 px-2 py-0.5 font-medium text-blue-700 border border-blue-100">
                              🛣️ {run.counts.routes} yo'nalish
                            </span>
                          )}
                          {typeof run.counts.drivers === "number" && run.counts.drivers > 0 && (
                            <span className="rounded-md bg-amber-50 px-2 py-0.5 font-medium text-amber-800 border border-amber-100">
                              👨‍✈️ {run.counts.drivers} haydovchi
                              {typeof run.counts.driversCreated === "number" && run.counts.driversCreated > 0 && (
                                <strong className="ml-1 text-emerald-600">(+{run.counts.driversCreated} yangi)</strong>
                              )}
                            </span>
                          )}
                          {typeof run.counts.records === "number" && run.counts.records > 0 && (
                            <span className="rounded-md bg-purple-50 px-2 py-0.5 font-medium text-purple-700 border border-purple-100">
                              📄 {run.counts.records} shartnoma/guvohnoma
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                      {run.error && (
                        <div className="mt-1.5 rounded-lg border border-red-200 bg-red-50/80 p-2 text-[11px] text-red-700">
                          {run.error}
                        </div>
                      )}
                    </td>
                    <td className="text-xs text-slate-500 whitespace-nowrap">
                      {formatDateTime(run.startedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-3 text-xs text-slate-500">{t("noSyncRuns")}</p>
        )}
      </div>
    </div>
  );
}
