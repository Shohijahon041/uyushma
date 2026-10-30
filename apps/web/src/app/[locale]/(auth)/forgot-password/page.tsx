"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { apiRequest } from "@/lib/client-api";
import { Alert } from "@/components/ui";

export default function ForgotPasswordPage() {
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const [companySlug, setCompanySlug] = useState("");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiRequest("/auth/forgot-password", {
        method: "POST",
        body: { companySlug, email },
      });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : tc("error"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h2 className="text-2xl font-bold tracking-tight text-slate-900">{t("forgotTitle")}</h2>
      <p className="mt-1.5 text-sm text-slate-500">{t("forgotSubtitle")}</p>

      {sent ? (
        <div className="mt-8 space-y-5">
          <Alert tone="success">{t("resetSent")}</Alert>
          <Link
            href="/login"
            className="btn-primary inline-flex w-full items-center justify-center"
          >
            {t("backToLogin")}
          </Link>
        </div>
      ) : (
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
          <button type="submit" className="btn-primary w-full" disabled={submitting}>
            {submitting ? t("sending") : t("sendReset")}
          </button>
          <p className="text-center text-sm text-slate-500">
            <Link href="/login" className="font-semibold text-brand-700 hover:text-brand-800">
              {t("backToLogin")}
            </Link>
          </p>
        </form>
      )}
    </div>
  );
}
