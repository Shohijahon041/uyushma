"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { apiRequest } from "@/lib/client-api";
import { formatDateTime, useApi } from "@/lib/use-api";
import type { AuthUser, DeviceSession } from "@/lib/types";
import { Alert, StatusBadge } from "@/components/ui";

export function SecuritySettings({
  me,
  onChanged,
}: {
  me: AuthUser;
  onChanged: () => void;
}) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const sessions = useApi<{ items: DeviceSession[] }>("/auth/sessions");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [enableCode, setEnableCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [disablePassword, setDisablePassword] = useState("");
  const [disableCode, setDisableCode] = useState("");

  async function run(action: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : tc("error"));
    } finally {
      setBusy(false);
    }
  }

  async function startSetup() {
    await run(async () => {
      const result = await apiRequest<{ secret: string; otpauthUri: string }>(
        "/auth/2fa/setup",
        { method: "POST", body: {} },
      );
      setSetup(result);
      setRecoveryCodes(null);
    });
  }

  async function confirmEnable() {
    await run(async () => {
      const result = await apiRequest<{ enabled: true; recoveryCodes: string[] }>(
        "/auth/2fa/enable",
        { method: "POST", body: { code: enableCode.trim() } },
      );
      setRecoveryCodes(result.recoveryCodes);
      setSetup(null);
      setEnableCode("");
      onChanged();
    });
  }

  async function disable() {
    await run(async () => {
      await apiRequest("/auth/2fa/disable", {
        method: "POST",
        body: { password: disablePassword, code: disableCode.trim() },
      });
      setDisablePassword("");
      setDisableCode("");
      setRecoveryCodes(null);
      onChanged();
    });
  }

  async function revoke(session: DeviceSession) {
    await run(async () => {
      await apiRequest(`/auth/sessions/${session.id}`, { method: "DELETE" });
      await sessions.reload();
    });
  }

  async function revokeOthers() {
    await run(async () => {
      await apiRequest("/auth/sessions/revoke-others", {
        method: "POST",
        body: {},
      });
      await sessions.reload();
    });
  }

  return (
    <div className="card card-body">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-bold text-slate-800">{t("security")}</h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            {t("twoFactorDescription")}
          </p>
        </div>
        <StatusBadge
          status={me.twoFactorEnabled ? "ACTIVE" : "INACTIVE"}
          label={me.twoFactorEnabled ? t("twoFactorEnabled") : t("twoFactorDisabled")}
        />
      </div>

      {error && (
        <div className="mt-4">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      <dl className="mt-4 space-y-2 text-sm">
        <div className="flex items-center justify-between gap-4">
          <dt className="text-slate-500">Telefon raqam</dt>
          <dd className="font-mono text-slate-800">{me.phone ?? "Kiritilmagan"}</dd>
        </div>
      </dl>

      {recoveryCodes && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/70 p-4">
          <p className="text-sm font-semibold text-amber-900">{t("recoveryCodesTitle")}</p>
          <p className="mt-1 text-xs text-amber-800">{t("recoveryCodesHint")}</p>
          <div className="mt-3 grid grid-cols-2 gap-1.5 font-mono text-xs text-amber-950">
            {recoveryCodes.map((code) => (
              <code key={code} className="rounded bg-white/80 px-2 py-1">
                {code}
              </code>
            ))}
          </div>
        </div>
      )}

      {!me.twoFactorEnabled && (
        <div className="mt-4 space-y-3">
          {!setup ? (
            <button
              type="button"
              className="btn-primary"
              onClick={() => void startSetup()}
              disabled={busy}
            >
              {t("setup2fa")}
            </button>
          ) : (
            <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs text-slate-600">{t("setupHint")}</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 break-all rounded bg-white px-2 py-1.5 font-mono text-xs text-slate-800">
                  {setup.secret}
                </code>
                <button
                  type="button"
                  className="btn-secondary shrink-0 px-2.5 py-1.5 text-xs"
                  onClick={() => void navigator.clipboard.writeText(setup.secret)}
                >
                  Copy
                </button>
              </div>
              <p className="break-all text-[11px] text-slate-400">{setup.otpauthUri}</p>
              <div>
                <label className="label" htmlFor="enable-code">
                  {t("enterCode")}
                </label>
                <input
                  id="enable-code"
                  className="input font-mono tracking-widest"
                  inputMode="numeric"
                  value={enableCode}
                  onChange={(event) => setEnableCode(event.target.value)}
                />
              </div>
              <button
                type="button"
                className="btn-primary"
                onClick={() => void confirmEnable()}
                disabled={busy || enableCode.replace(/\s/g, "").length !== 6}
              >
                {t("confirm2fa")}
              </button>
            </div>
          )}
        </div>
      )}

      {me.twoFactorEnabled && (
        <div className="mt-4 space-y-3 rounded-xl border border-slate-200 p-4">
          <div>
            <label className="label" htmlFor="disable-password">
              {t("password")}
            </label>
            <input
              id="disable-password"
              type="password"
              className="input"
              autoComplete="current-password"
              value={disablePassword}
              onChange={(event) => setDisablePassword(event.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="disable-code">
              {t("enterCode")}
            </label>
            <input
              id="disable-code"
              className="input font-mono tracking-widest"
              inputMode="numeric"
              value={disableCode}
              onChange={(event) => setDisableCode(event.target.value)}
            />
          </div>
          <button
            type="button"
            className="btn-secondary text-red-700"
            onClick={() => void disable()}
            disabled={busy || !disablePassword || disableCode.replace(/\s/g, "").length !== 6}
          >
            {t("disable2fa")}
          </button>
        </div>
      )}

      <div className="mt-6 border-t border-slate-100 pt-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-800">{t("sessions")}</h3>
            <p className="mt-1 text-xs text-slate-500">{t("sessionsDescription")}</p>
          </div>
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={() => void revokeOthers()}
            disabled={busy}
          >
            {t("revokeOthers")}
          </button>
        </div>

        <div className="mt-3 space-y-2">
          {sessions.data?.items.map((session) => (
            <div
              key={session.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-800">
                  {session.deviceLabel ?? "—"}
                  {session.current && (
                    <span className="ml-2 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-700">
                      {t("currentSession")}
                    </span>
                  )}
                </p>
                <p className="mt-0.5 truncate text-xs text-slate-500">
                  {session.ip ?? "—"} · {t("lastUsed")}: {formatDateTime(session.lastUsedAt)}
                </p>
              </div>
              <button
                type="button"
                className="btn-ghost text-xs text-red-700"
                onClick={() => void revoke(session)}
                disabled={busy}
              >
                {t("revoke")}
              </button>
            </div>
          ))}
          {sessions.loading && <p className="text-xs text-slate-400">{tc("loading")}</p>}
        </div>
      </div>
    </div>
  );
}
