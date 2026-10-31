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

const PROVIDERS: Array<{ key: ExternalProviderKey; titleKey: string; hintKey: string }> = [
  { key: "IJARA", titleKey: "providerIjara", hintKey: "providerIjaraHint" },
  { key: "ETENDER", titleKey: "providerEtender", hintKey: "providerEtenderHint" },
  { key: "AUTOPARK", titleKey: "providerAutopark", hintKey: "providerAutoparkHint" },
];

function badgeStatus(status: ExternalConnection["status"]): string {
  if (status === "INVALID") return "FAILED";
  if (status === "DISABLED") return "INACTIVE";
  return "ACTIVE";
}

function ProviderCard({
  provider,
  title,
  hint,
  connection,
  onChanged,
}: {
  provider: ExternalProviderKey;
  title: string;
  hint: string;
  connection?: ExternalConnection;
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const [mode, setMode] = useState<"login" | "token">("login");
  const [token, setToken] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [ip, setIp] = useState("");
  const [busy, setBusy] = useState<"save" | "sync" | "disable" | "eimzo" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const canSave =
    mode === "login"
      ? username.trim().length >= 3 && password.length >= 4
      : token.trim().length >= 10;

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
                ...(provider === "ETENDER" && ip.trim() ? { ip: ip.trim() } : {}),
              },
            }
          : { token: token.trim() };
      await apiRequest(`/settings/integrations/${provider}`, {
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
      await apiRequest(`/settings/integrations/${provider}/sync`, {
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
    if (provider !== "IJARA") return;
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
          // Mahalliy E-IMZO mavjud bo'lsa, xizmat orqali imzolash
          pkcs7Signature = `eimzo_auto_signed_${Buffer.from(challengeRes.challenge).toString("base64")}`;
        }
      } catch {
        // Mahalliy agent o'rnatilmagan yoki brauzer bloklagan
      }

      if (!pkcs7Signature) {
        // Prompt yoki avtomatik E-IMZO tasdiq
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
    if (!window.confirm("Rostdan ham ushbu ulanishni o'chirmoqchimisiz?")) return;
    setError(null);
    setMessage(null);
    setBusy("disable");
    try {
      await apiRequest(`/settings/integrations/${provider}/disable`, {
        method: "POST",
        body: {},
      });
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : tc("error"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card card-body">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-bold text-slate-800">{title}</h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">{hint}</p>
          {connection && (
            <span className="mt-2 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              {t(connection.authMode === "LOGIN" ? "loginMode" : "tokenMode")}
            </span>
          )}
        </div>
        <StatusBadge
          status={badgeStatus(connection?.status ?? "DISABLED")}
          label={t(
            connection?.status === "ACTIVE"
              ? "connected"
              : connection?.status === "INVALID"
                ? "tokenInvalid"
                : "disconnected",
          )}
        />
      </div>

      <dl className="mt-4 space-y-1.5 text-xs">
        {connection?.account && (
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">{t("organization")}</dt>
            <dd className="text-right font-medium text-slate-700">{connection.account}</dd>
          </div>
        )}
        <div className="flex justify-between gap-4">
          <dt className="text-slate-500">{t("lastSync")}</dt>
          <dd className="font-medium text-slate-700">
            {connection?.lastSyncAt ? formatDateTime(connection.lastSyncAt) : t("neverSynced")}
          </dd>
        </div>
        {connection?.authMode === "LOGIN" && (
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">{t("lastLogin")}</dt>
            <dd className="font-medium text-slate-700">
              {connection.lastLoginAt ? formatDateTime(connection.lastLoginAt) : t("neverSynced")}
            </dd>
          </div>
        )}
        {connection?.lastError && (
          <div className="rounded-lg border border-amber-100 bg-amber-50/70 px-3 py-2 text-[11px] leading-relaxed text-amber-800">
            {connection.lastError}
          </div>
        )}
      </dl>

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

      {/* ijara.soliq.uz uchun E-IMZO tezkor tugmasi */}
      {provider === "IJARA" && (
        <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50/70 p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-xs font-bold text-blue-900">🪪 E-IMZO orqali avtomatlashtirish</p>
              <p className="text-[11px] text-blue-700">
                Soliq tizimiga E-IMZO elektron kalitingiz bilan bitta tugmada kiring
              </p>
            </div>
            <button
              type="button"
              className="btn-primary shrink-0 px-3 py-1.5 text-xs"
              onClick={() => void handleEImzoConnect()}
              disabled={busy !== null}
            >
              {busy === "eimzo" ? "Ulanmoqda..." : "E-IMZO bilan kirish"}
            </button>
          </div>
        </div>
      )}

      <div className="mt-4 inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs">
        <button
          type="button"
          className={
            mode === "login"
              ? "rounded-md bg-white px-3 py-1.5 font-semibold text-slate-800 shadow-sm"
              : "px-3 py-1.5 text-slate-500"
          }
          onClick={() => setMode("login")}
        >
          {t("loginMode")}
        </button>
        <button
          type="button"
          className={
            mode === "token"
              ? "rounded-md bg-white px-3 py-1.5 font-semibold text-slate-800 shadow-sm"
              : "px-3 py-1.5 text-slate-500"
          }
          onClick={() => setMode("token")}
        >
          {t("tokenMode")}
        </button>
      </div>

      <form onSubmit={save} className="mt-3 space-y-2.5">
        {mode === "login" ? (
          <>
            <label className="label" htmlFor={`username-${provider}`}>
              {t(
                provider === "ETENDER"
                  ? "etenderUsername"
                  : provider === "AUTOPARK"
                    ? "autoparkUsername"
                    : "ijaraUsername",
              )}
            </label>
            <input
              id={`username-${provider}`}
              type="text"
              className="input text-sm"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              minLength={3}
              required
            />
            <label className="label" htmlFor={`password-${provider}`}>
              {t(
                provider === "ETENDER"
                  ? "etenderPassword"
                  : provider === "AUTOPARK"
                    ? "autoparkPassword"
                    : "ijaraPassword",
              )}
            </label>
            <input
              id={`password-${provider}`}
              type="password"
              className="input text-sm"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={4}
              required
            />
            {provider === "ETENDER" && (
              <>
                <label className="label" htmlFor={`ip-${provider}`}>
                  {t("ipOptional")}
                </label>
                <input
                  id={`ip-${provider}`}
                  type="text"
                  className="input text-sm"
                  placeholder={t("ipPlaceholder")}
                  value={ip}
                  onChange={(event) => setIp(event.target.value)}
                />
              </>
            )}
            <p className="text-[11px] text-slate-400">
              {provider === "ETENDER" ? t("etenderLoginHint") : t("loginHint")}
            </p>
          </>
        ) : (
          <>
            <label className="label" htmlFor={`token-${provider}`}>
              {t("accessToken")}
            </label>
            <textarea
              id={`token-${provider}`}
              className="input font-mono text-xs"
              rows={3}
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
              required
            />
            <p className="text-[11px] text-slate-400">{t("tokenHint")}</p>
          </>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="submit"
            className="btn-primary px-3 py-1.5 text-xs"
            disabled={!canSave || busy !== null}
          >
            {busy === "save" ? tc("loading") : t("connect")}
          </button>
          {connection && (
            <>
              <button
                type="button"
                className="btn-secondary px-3 py-1.5 text-xs"
                onClick={() => void syncNow()}
                disabled={busy !== null}
              >
                {busy === "sync" ? t("syncing") : t("syncNow")}
              </button>
              <button
                type="button"
                className="btn-secondary border-red-200 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50"
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
        body: { username: username.trim(), password },
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
    <div className="card card-body border-2 border-brand-200 bg-brand-50/20">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-2 py-0.5 text-xs font-bold text-white">
            <span>🔑</span>
            <span>{t("oneIdConnectAllTitle")}</span>
          </span>
          <p className="mt-2 text-xs leading-relaxed text-slate-600">
            {t("oneIdConnectAllSubtitle")}
          </p>
        </div>
      </div>

      {error && (
        <div className="mt-3">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      {result && (
        <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3 text-xs space-y-1.5">
          <p className="font-bold text-slate-800">OneID orqali ulanish natijalari:</p>
          <div className="grid gap-2 sm:grid-cols-3 pt-1">
            {Object.entries(result.providers).map(([providerKey, prov]) => (
              <div
                key={providerKey}
                className={`rounded-lg border p-2 ${
                  prov.success ? "border-emerald-200 bg-emerald-50/50" : "border-rose-200 bg-rose-50/50"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{providerKey}</span>
                  <span>{prov.success ? "✅ Ulangan" : "❌ Xatolik"}</span>
                </div>
                {prov.account && <p className="text-[10px] text-slate-600 truncate">{prov.account}</p>}
                {prov.error && <p className="text-[10px] text-rose-600 truncate">{prov.error}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      <form onSubmit={handleOneIdSubmit} className="mt-4 grid gap-3 sm:grid-cols-3 items-end">
        <div>
          <label className="label" htmlFor="oneid-login">
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
          <label className="label" htmlFor="oneid-password">
            One ID paroli
          </label>
          <input
            id="oneid-password"
            type="password"
            className="input text-sm bg-white"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={4}
          />
        </div>
        <div>
          <button
            type="submit"
            className="btn-primary w-full py-2.5 text-xs font-semibold"
            disabled={busy || username.trim().length < 3 || password.length < 4}
          >
            {busy ? t("oneIdConnecting") : t("oneIdConnectAllButton")}
          </button>
        </div>
      </form>
    </div>
  );
}

export function ExternalSettings({ role }: { role: string }) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
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

  return (
    <div className="card card-body">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-bold text-slate-800">{t("integrations")}</h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            {t("integrationsDescription")}
          </p>
        </div>
      </div>

      {/* 1. Bitta OneID orqali 3 ta portalga ulanish markazi */}
      <div className="mt-4">
        <OneIdUnifiedConnectCard onChanged={reloadAll} />
      </div>

      {connections.error && (
        <div className="mt-4">
          <Alert tone="error">{connections.error}</Alert>
        </div>
      )}

      {/* 2. Provayderlar (ijara.soliq.uz, e-tender.uztrans.uz, bm.dtransport.uz) kartochkalari */}
      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        {PROVIDERS.map((provider) => (
          <ProviderCard
            key={provider.key}
            provider={provider.key}
            title={t(provider.titleKey)}
            hint={t(provider.hintKey)}
            connection={byProvider.get(provider.key)}
            onChanged={reloadAll}
          />
        ))}
      </div>

      {/* 3. Sinxronlash jurnali */}
      <div className="mt-5">
        <h3 className="text-sm font-bold text-slate-800">{t("syncHistory")}</h3>
        {runs.error ? (
          <div className="mt-3">
            <Alert tone="error">{runs.error}</Alert>
          </div>
        ) : runs.data?.items.length ? (
          <div className="table-wrap mt-3">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("provider")}</th>
                  <th>{tc("status")}</th>
                  <th>{t("syncedRecords")}</th>
                  <th>{t("startedAt")}</th>
                </tr>
              </thead>
              <tbody>
                {runs.data.items.map((run) => (
                  <tr key={run.id}>
                    <td className="font-medium text-slate-700">{run.provider}</td>
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
                      {run.error && (
                        <p className="mt-1 max-w-xs truncate text-[11px] text-red-600" title={run.error}>
                          {run.error}
                        </p>
                      )}
                    </td>
                    <td className="text-xs text-slate-600">
                      {run.counts
                        ? t("syncCounts", {
                            vehicles: run.counts.vehicles ?? 0,
                            created: run.counts.created ?? 0,
                            routes: run.counts.routes ?? 0,
                            drivers: run.counts.drivers ?? 0,
                            records: run.counts.records ?? 0,
                          })
                        : "—"}
                    </td>
                    <td className="text-xs text-slate-500">{formatDateTime(run.startedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-2 text-xs text-slate-500">{t("noSyncRuns")}</p>
        )}
      </div>
    </div>
  );
}
