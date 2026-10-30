"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { sessionLogin, sessionVerifyTwoFactor } from "@/lib/client-api";
import { Alert } from "@/components/ui";

export default function LoginPage() {
  const t = useTranslations("auth");
  const router = useRouter();
  const [companySlug, setCompanySlug] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await sessionLogin({ companySlug, email, password });
      if ("mfaRequired" in result) {
        setMfaToken(result.mfaToken);
        setSubmitting(false);
        return;
      }
      router.replace("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("invalidCredentials"));
      setSubmitting(false);
    }
  }

  async function onVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mfaToken) return;
    setError(null);
    setSubmitting(true);
    try {
      await sessionVerifyTwoFactor(
        recoveryMode ? { mfaToken, recoveryCode: code } : { mfaToken, code },
      );
      router.replace("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("invalidCredentials"));
      setSubmitting(false);
    }
  }

  if (mfaToken) {
    return (
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">
          {t("twoFactorTitle")}
        </h2>
        <p className="mt-1.5 text-sm text-slate-500">{t("twoFactorSubtitle")}</p>

        <form onSubmit={onVerify} className="mt-8 space-y-5">
          {error && <Alert tone="error">{error}</Alert>}
          <div>
            <label htmlFor="code" className="label">
              {recoveryMode ? t("recoveryCode") : t("code")}
            </label>
            <input
              id="code"
              className="input font-mono tracking-widest"
              autoComplete="one-time-code"
              inputMode={recoveryMode ? "text" : "numeric"}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              required
              autoFocus
            />
          </div>
          <button
            type="submit"
            className="btn-primary w-full"
            disabled={submitting || code.trim().length === 0}
          >
            {submitting ? t("verifying") : t("verify")}
          </button>
          <button
            type="button"
            className="w-full text-center text-sm font-semibold text-brand-700 hover:text-brand-800"
            onClick={() => {
              setRecoveryMode((value) => !value);
              setCode("");
              setError(null);
            }}
          >
            {recoveryMode ? t("useApp") : t("useRecovery")}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-2xl font-bold tracking-tight text-slate-900">{t("loginTitle")}</h2>
      <p className="mt-1.5 text-sm text-slate-500">{t("loginSubtitle")}</p>

      <form onSubmit={onSubmit} className="mt-8 space-y-5">
        {error && <Alert tone="error">{error}</Alert>}
        <div>
          <label htmlFor="companySlug" className="label">
            {t("companyCode")}
          </label>
          <input
            id="companySlug"
            className="input"
            autoComplete="organization"
            placeholder={t("companyCodeHint")}
            value={companySlug}
            onChange={(event) => setCompanySlug(event.target.value)}
            required
          />
        </div>
        <div>
          <label htmlFor="email" className="label">
            {t("email")}
          </label>
          <input
            id="email"
            type="email"
            className="input"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </div>
        <div>
          <label htmlFor="password" className="label">
            {t("password")}
          </label>
          <input
            id="password"
            type="password"
            className="input"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </div>
        <div className="flex justify-end">
          <Link
            href="/forgot-password"
            className="text-sm font-semibold text-brand-700 hover:text-brand-800"
          >
            {t("forgotPassword")}
          </Link>
        </div>
        <button type="submit" className="btn-primary w-full" disabled={submitting}>
          {submitting ? t("loggingIn") : t("login")}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-500">
        {t("noAccount")}{" "}
        <Link href="/register" className="font-semibold text-brand-700 hover:text-brand-800">
          {t("registerLink")}
        </Link>
      </p>
    </div>
  );
}
