"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { apiRequest } from "@/lib/client-api";
import { useApi } from "@/lib/use-api";
import type { PaymeConfig } from "@/lib/types";
import { Alert, StatusBadge } from "@/components/ui";

export function PaymeSettings({ role }: { role: string }) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const config = useApi<PaymeConfig>("/settings/payments/payme");
  const [merchantId, setMerchantId] = useState("");
  const [login, setLogin] = useState("Paycom");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const canEdit = role === "OWNER";

  useEffect(() => {
    if (config.data?.configured) {
      setMerchantId(config.data.merchantId ?? "");
      setLogin(config.data.login ?? "Paycom");
    }
  }, [config.data]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    setBusy(true);
    try {
      await apiRequest("/settings/payments/payme", {
        method: "PUT",
        body: { merchantId, login, secret, isActive: true },
      });
      setSecret("");
      setSaved(true);
      await config.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : tc("error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card card-body">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-bold text-slate-800">{t("payments")}</h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            {t("paymentsDescription")}
          </p>
        </div>
        <StatusBadge
          status={config.data?.configured ? "ACTIVE" : "INACTIVE"}
          label={config.data?.configured ? t("configured") : t("notConfigured")}
        />
      </div>

      {config.data?.webhookPath && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            {t("webhookPath")}
          </p>
          <div className="mt-1 flex items-center gap-2">
            <code className="flex-1 break-all font-mono text-xs text-slate-800">
              {config.data.webhookPath}
            </code>
            <button
              type="button"
              className="btn-secondary shrink-0 px-2.5 py-1.5 text-xs"
              onClick={() =>
                config.data?.webhookPath &&
                void navigator.clipboard.writeText(config.data.webhookPath)
              }
            >
              Copy
            </button>
          </div>
          <p className="mt-1 text-[11px] text-slate-400">{t("webhookHint")}</p>
        </div>
      )}

      {error && (
        <div className="mt-4">
          <Alert tone="error">{error}</Alert>
        </div>
      )}
      {saved && (
        <div className="mt-4">
          <Alert tone="success">{t("saved")}</Alert>
        </div>
      )}

      {canEdit ? (
        <form onSubmit={onSubmit} className="mt-4 space-y-3">
          <div>
            <label className="label" htmlFor="payme-merchant">
              {t("merchantId")}
            </label>
            <input
              id="payme-merchant"
              className="input font-mono"
              value={merchantId}
              onChange={(event) => setMerchantId(event.target.value)}
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="payme-login">
              {t("login")}
            </label>
            <input
              id="payme-login"
              className="input"
              value={login}
              onChange={(event) => setLogin(event.target.value)}
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="payme-secret">
              {t("secretKeyPayme")}
            </label>
            <input
              id="payme-secret"
              type="password"
              className="input"
              autoComplete="off"
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              minLength={8}
              required
            />
          </div>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? t("saving") : t("save")}
          </button>
        </form>
      ) : (
        <p className="mt-4 text-xs text-slate-500">{t("paymentsDescription")}</p>
      )}
    </div>
  );
}
