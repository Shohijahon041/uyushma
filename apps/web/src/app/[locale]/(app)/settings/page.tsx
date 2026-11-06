"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { apiRequest } from "@/lib/client-api";
import { formatDateTime, useApi } from "@/lib/use-api";
import type { AuthUser, TelegramStatus } from "@/lib/types";
import { Alert, Loading, PageHeader, StatusBadge } from "@/components/ui";
import { SecuritySettings } from "@/components/security-settings";
import { PaymeSettings } from "@/components/payme-settings";
import { ExternalSettings } from "@/components/external-settings";
import { CompanyPaymentSettings } from "@/components/company-payment-settings";

export default function SettingsPage() {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const users = useTranslations("users");
  const me = useApi<AuthUser>("/auth/me");
  const status = useApi<TelegramStatus>("/settings/telegram");
  const [token, setToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingToken, setLoadingToken] = useState(false);
  const [copied, setCopied] = useState(false);

  async function generateToken() {
    setError(null);
    setLoadingToken(true);
    try {
      const result = await apiRequest<{ token: string; expiresAt: string }>(
        "/settings/telegram/link-token",
        { method: "POST", body: {} },
      );
      setToken(result.token);
      setExpiresAt(result.expiresAt);
      setCopied(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : tc("error"));
    } finally {
      setLoadingToken(false);
    }
  }

  async function copyCommand() {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(`/start ${token}`);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  if (me.loading && !me.data) return <Loading label={tc("loading")} />;
  if (me.error) return <Alert tone="error">{me.error}</Alert>;
  if (!me.data) return null;

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="card card-body">
          <h2 className="text-sm font-bold text-slate-800">{t("profile")}</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">{users("fullName")}</dt>
              <dd className="font-medium text-slate-900">{me.data.fullName}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">{t("company")}</dt>
              <dd className="text-right">
                <p className="font-medium text-slate-900">{me.data.company.name}</p>
                <p className="font-mono text-xs text-slate-400">{me.data.company.slug}</p>
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">{users("phone")}</dt>
              <dd className="font-medium text-slate-900">{me.data.phone ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">{t("role")}</dt>
              <dd>
                <StatusBadge status="ACTIVE" label={users(me.data.role)} />
              </dd>
            </div>
          </dl>
        </div>

        <div className="card card-body">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-bold text-slate-800">{t("telegram")}</h2>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">
                {t("telegramDescription")}
              </p>
            </div>
            <StatusBadge
              status={status.data?.linked ? "ACTIVE" : "INACTIVE"}
              label={status.data?.linked ? t("linked") : t("notLinked")}
            />
          </div>

          {error && (
            <div className="mt-4">
              <Alert tone="error">{error}</Alert>
            </div>
          )}

          {status.data?.linked ? (
            <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50/70 p-4 text-sm">
              <p className="text-slate-600">
                {status.data.username ? `@${status.data.username}` : t("chatId")}
              </p>
              <p className="mt-1 text-xs text-slate-400">
                {t("linkedAt")}: {formatDateTime(status.data.linkedAt)}
              </p>
              <a
                href="https://t.me/uyushma_saas_bot"
                target="_blank"
                rel="noreferrer"
                className="btn-secondary mt-3 inline-flex items-center gap-1.5 text-xs"
              >
                ✈️ {t("openBot")}
              </a>
            </div>
          ) : (
            <div className="mt-4">
              {!token ? (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => void generateToken()}
                  disabled={loadingToken}
                >
                  {loadingToken ? t("generating") : t("generateToken")}
                </button>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-slate-500">{t("tokenInstruction")}</p>
                  <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                    <code className="flex-1 break-all font-mono text-xs text-slate-800">
                      /start {token}
                    </code>
                    <button
                      type="button"
                      className="btn-secondary shrink-0 px-2.5 py-1.5 text-xs"
                      onClick={() => void copyCommand()}
                    >
                      {copied ? "✓" : "Copy"}
                    </button>
                  </div>
                  <div>
                    <a
                      href={`https://t.me/uyushma_saas_bot?start=${token}`}
                      target="_blank"
                      rel="noreferrer"
                      className="btn-primary inline-flex items-center gap-2 text-xs"
                    >
                      ✈️ {t("openBot")}
                    </a>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    {t("tokenExpires")}
                    {expiresAt && ` · ${formatDateTime(expiresAt)}`}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <SecuritySettings me={me.data} onChanged={() => void me.reload()} />
        <CompanyPaymentSettings role={me.data.role} />
      </div>

      <div className="mt-5">
        <PaymeSettings role={me.data.role} />
      </div>

      {/* Tashqi tizimlar integratsiyasi (Keng, qulay va to'liq ko'rinish) */}
      <div className="mt-6 w-full">
        <ExternalSettings role={me.data.role} />
      </div>

      <div className="card card-body mt-5">
        <h2 className="text-sm font-bold text-slate-800">Xavfsizlik eslatmasi</h2>
        <ul className="mt-3 space-y-2 text-sm text-slate-600">
          <li>Parollar Argon2id bilan hash qilinadi va hech qachon ochiq saqlanmaydi.</li>
          <li>Har bir kompaniya ma'lumoti PostgreSQL Row Level Security bilan ajratilgan.</li>
          <li>Tokenlar httpOnly cookie'da saqlanadi; brauzer JavaScript'i ularni o'qiy olmaydi.</li>
          <li>Muhim operatsiyalar o'zgartirilmaydigan audit jurnaliga yoziladi.</li>
        </ul>
      </div>
    </>
  );
}
