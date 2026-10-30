"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { apiRequest } from "@/lib/client-api";
import { Alert } from "@/components/ui";

function ResetPasswordForm() {
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const params = useSearchParams();
  const companySlug = params.get("slug") ?? "";
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const validLink = companySlug.length > 0 && token.length > 0;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiRequest("/auth/reset-password", {
        method: "POST",
        body: { companySlug, token, password },
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : tc("error"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h2 className="text-2xl font-bold tracking-tight text-slate-900">{t("resetTitle")}</h2>
      <p className="mt-1.5 text-sm text-slate-500">{t("resetSubtitle")}</p>

      {!validLink ? (
        <div className="mt-8 space-y-5">
          <Alert tone="error">{t("verifyFailed")}</Alert>
          <Link
            href="/forgot-password"
            className="btn-primary inline-flex w-full items-center justify-center"
          >
            {t("forgotPassword")}
          </Link>
        </div>
      ) : done ? (
        <div className="mt-8 space-y-5">
          <Alert tone="success">{t("resetDone")}</Alert>
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
            <label htmlFor="password" className="label">
              {t("newPassword")}
            </label>
            <input
              id="password"
              type="password"
              className="input"
              autoComplete="new-password"
              minLength={12}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
            <p className="mt-1.5 text-xs text-slate-500">{t("passwordHint")}</p>
          </div>
          <button type="submit" className="btn-primary w-full" disabled={submitting}>
            {submitting ? t("resetting") : t("resetPassword")}
          </button>
        </form>
      )}
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
