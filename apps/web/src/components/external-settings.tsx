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
  const [busy, setBusy] = useState<"save" | "sync" | "disable" | null>(null);
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

  async function disable() {
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
          label={t(connection?.status === "ACTIVE" ? "connected" : connection?.status === "INVALID" ? "tokenInvalid" : "disconnected")}
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
              {t(provider === "ETENDER" ? "etenderUsername" : "autoparkUsername")}
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
              {t(provider === "ETENDER" ? "etenderPassword" : "autoparkPassword")}
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
                  className="input font-mono text-xs"
                  value={ip}
                  onChange={(event) => setIp(event.target.value)}
                  placeholder={t("ipPlaceholder")}
                  maxLength={64}
                />
              </>
            )}
            <p className="text-[11px] leading-relaxed text-slate-400">{t("loginHint")}</p>
            {provider === "ETENDER" && (
              <p className="text-[11px] leading-relaxed text-amber-600">
                {t("etenderLoginHint")}
              </p>
            )}
          </>
        ) : (
          <>
            <label className="label" htmlFor={`token-${provider}`}>
              {t("accessToken")}
            </label>
            <input
              id={`token-${provider}`}
              type="password"
              className="input font-mono text-xs"
              autoComplete="off"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              minLength={10}
              required
              placeholder="Bearer token"
            />
            <p className="text-[11px] leading-relaxed text-slate-400">{t("tokenHint")}</p>
          </>
        )}

        <div className="flex flex-wrap gap-2">
          <button type="submit" className="btn-primary" disabled={busy !== null || !canSave}>
            {busy === "save" ? t("saving") : t("connect")}
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void syncNow()}
            disabled={busy !== null || connection?.status !== "ACTIVE"}
          >
            {busy === "sync" ? t("syncing") : t("syncNow")}
          </button>
          {connection && connection.status !== "DISABLED" && (
            <button
              type="button"
              className="btn-ghost text-xs text-red-600"
              onClick={() => void disable()}
              disabled={busy !== null}
            >
              {t("disconnect")}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

export function ExternalSettings({ role }: { role: string }) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const connections = useApi<{ items: ExternalConnection[] }>("/settings/integrations");
  const runs = useApi<{ items: ExternalSyncRun[] }>("/settings/integrations/runs?limit=8");

  if (role !== "OWNER" && role !== "ADMIN") return null;

  const byProvider = new Map(
    (connections.data?.items ?? []).map((item) => [item.provider, item]),
  );

  async function reloadAll() {
    await Promise.all([connections.reload(), runs.reload()]);
  }

  return (
    <div className="card card-body">
      <div>
        <h2 className="text-sm font-bold text-slate-800">{t("integrations")}</h2>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          {t("integrationsDescription")}
        </p>
      </div>

      {connections.error && (
        <div className="mt-4">
          <Alert tone="error">{connections.error}</Alert>
        </div>
      )}

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
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
