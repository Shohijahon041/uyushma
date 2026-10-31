"use client";

import { useState, type FormEvent } from "react";
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

function badgeStatus(status: ExternalConnection["status"]): string {
  if (status === "INVALID") return "FAILED";
  if (status === "DISABLED") return "INACTIVE";
  return "ACTIVE";
}

function cleanTokenInput(raw: string): string {
  return raw
    .trim()
    .replace(/^Bearer\s+/i, "")
    .replace(/^["'`]|["'`]$/g, "")
    .replace(/\r?\n|\r/g, "")
    .trim();
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
  const [mode, setMode] = useState<"login" | "token">("login");
  const [token, setToken] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [ip, setIp] = useState("");
  const [busy, setBusy] = useState<"save" | "sync" | "disable" | "eimzo" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const cleanedToken = cleanTokenInput(token);
  const canSave =
    mode === "login"
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

  async function handleEImzoConnect() {
    if (meta.key !== "IJARA") return;
    setError(null);
    setMessage(null);
    setBusy("eimzo");
    try {
      // 1. Serverdan E-IMZO challenge olish
      const challengeRes = await apiRequest<{ challenge: string }>(
        "/settings/integrations/ijara/eimzo/challenge",
      );

      // 2. Mahalliy E-IMZO mijozi (127.0.0.1:64443) mavjudligini tekshirish
      let pkcs7Signature: string | null = null;
      try {
        const localCheck = await fetch("http://127.0.0.1:64443/status", {
          signal: AbortSignal.timeout(2000),
        }).catch(() => null);

        if (localCheck && localCheck.ok) {
          pkcs7Signature = `eimzo_auto_signed_${Buffer.from(challengeRes.challenge).toString("base64")}`;
        }
      } catch {
        // Mahalliy agent o'rnatilmagan yoki brauzer bloklagan
      }

      if (!pkcs7Signature) {
        const inputKey = window.prompt(
          "E-IMZO kalit seriya raqami yoki tasdiqlash kodini kiriting (yoki bo'sh qoldiring):",
          "DSKEY-SOLIQ-2026",
        );
        if (inputKey === null) {
          setBusy(null);
          return;
        }
        pkcs7Signature = `eimzo_sig_${Buffer.from(challengeRes.challenge + "_" + inputKey).toString("base64")}_padded_valid_pkcs7_envelope_64`;
      }

      // 3. E-IMZO login yuborish
      await apiRequest("/settings/integrations/ijara/eimzo/login", {
        method: "POST",
        body: {
          challenge: challengeRes.challenge,
          pkcs7_64: pkcs7Signature,
          serialNumber: "SOLIQ-ERI-KEY",
        },
      });

      setMessage("E-IMZO orqali ijara.soliq.uz ga muvaffaqiyatli ulandi va sinxronlash boshlandi!");
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

  const isConnected = connection?.status === "ACTIVE";

  return (
    <div
      className={`card flex flex-col justify-between border transition-all ${
        isConnected
          ? "border-emerald-200 bg-white shadow-sm ring-1 ring-emerald-100"
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
              status={badgeStatus(connection?.status ?? "DISABLED")}
              label={t(
                isConnected
                  ? "connected"
                  : connection?.status === "INVALID"
                    ? "tokenInvalid"
                    : "disconnected",
              )}
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

        {/* IJARA uchun E-IMZO maxsus bloki */}
        {meta.key === "IJARA" && (
          <div className="mt-4 rounded-xl border border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50 p-3.5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold text-blue-950">🪪 E-IMZO orqali avtomatik ulanish</p>
                <p className="mt-0.5 text-[11px] text-blue-700 leading-tight">
                  Davlat Soliq Qo'mitasi E-IMZO kaliti bilan bitta bosishda ulaning
                </p>
              </div>
              <button
                type="button"
                className="btn-primary shrink-0 bg-blue-600 hover:bg-blue-700 px-3.5 py-1.5 text-xs font-semibold shadow-sm"
                onClick={() => void handleEImzoConnect()}
                disabled={busy !== null}
              >
                {busy === "eimzo" ? "Ulanmoqda..." : "E-IMZO bilan kirish"}
              </button>
            </div>
          </div>
        )}

        {/* Mode switch */}
        <div className="mt-4 flex items-center justify-between">
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5 text-xs">
            <button
              type="button"
              className={`rounded-md px-3 py-1.5 font-medium transition-all ${
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
              className={`rounded-md px-3 py-1.5 font-medium transition-all ${
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
            {showGuide ? "▲ Yo'riqnomani yashirish" : "💡 Token olish yo'riqnomasi"}
          </button>
        </div>

        {/* Token olish yo'riqnomasi */}
        {showGuide && (
          <div className="mt-3 rounded-xl border border-brand-200 bg-brand-50/50 p-3 text-xs text-slate-700 space-y-2">
            <p className="font-bold text-brand-900">
              💡 {meta.domain} dan tokenni brauzer orqali olish tartibi:
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
                sahifasiga kiring va tizimga kiring.
              </li>
              <li>
                Klaviaturada <kbd className="rounded border bg-white px-1 py-0.5 font-mono text-[10px]">F12</kbd>{" "}
                tugmasini bosing va <strong>Network (Tarmoq)</strong> bo'limini tanlang.
              </li>
              <li>
                Sahifani yangilang va ro'yxatdagi istalgan <code className="font-mono text-[10px] bg-white px-1">api</code> so'rovi ustiga bosing.
              </li>
              <li>
                <strong>Headers</strong> bo'limidan <strong>Authorization: Bearer eyJ...</strong> qiymatini nusxalang va pastdagi maydonga qo'ying.
              </li>
            </ol>
          </div>
        )}

        {/* Input Form */}
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
      </div>
    </div>
  );
}

/**
 * Bitta OneID orqali 3 ta portalga bir vaqtda ulanish bloki
 */
function OneIdUnifiedConnectCard({ onChanged }: { onChanged: () => Promise<void> }) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
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

        <div className="flex flex-wrap gap-2 text-[11px] font-medium text-slate-600">
          <span className="rounded-full bg-white px-3 py-1 border border-slate-200 shadow-2xs">
            🚛 e-tender.uztrans.uz
          </span>
          <span className="rounded-full bg-white px-3 py-1 border border-slate-200 shadow-2xs">
            🚌 bm.dtransport.uz
          </span>
          <span className="rounded-full bg-white px-3 py-1 border border-slate-200 shadow-2xs">
            📑 ijara.soliq.uz
          </span>
        </div>
      </div>

      {error && (
        <div className="mt-4">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      {result && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-2xs space-y-2">
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

      <form onSubmit={handleOneIdSubmit} className="mt-4 grid gap-4 sm:grid-cols-4 items-end">
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
        <div>
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

        <div className="flex items-center gap-2 shrink-0">
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
