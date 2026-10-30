"use client";

import { Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { apiRequest } from "@/lib/client-api";
import { Alert, Loading } from "@/components/ui";

type State = "verifying" | "verified" | "failed";

function VerifyEmailContent() {
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const params = useSearchParams();
  const companySlug = params.get("slug") ?? "";
  const token = params.get("token") ?? "";
  const [state, setState] = useState<State>("verifying");
  const [slugInput, setSlugInput] = useState(companySlug);
  const [email, setEmail] = useState("");
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent">("idle");
  const [resendError, setResendError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!companySlug || !token) {
      setState("failed");
      return;
    }
    apiRequest("/auth/verify-email", {
      method: "POST",
      body: { companySlug, token },
    })
      .then(() => setState("verified"))
      .catch(() => setState("failed"));
  }, [companySlug, token]);

  async function onResend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResendError(null);
    setResendState("sending");
    try {
      await apiRequest("/auth/verify-email/resend", {
        method: "POST",
        body: { companySlug: companySlug || slugInput, email },
      });
      setResendState("sent");
    } catch (err) {
      setResendError(err instanceof Error ? err.message : tc("error"));
      setResendState("idle");
    }
  }

  return (
    <div>
      <h2 className="text-2xl font-bold tracking-tight text-slate-900">{t("verifyTitle")}</h2>
      <p className="mt-1.5 text-sm text-slate-500">{t("verifySubtitle")}</p>

      {state === "verifying" && <Loading label={t("verifyingEmail")} />}

      {state === "verified" && (
        <div className="mt-8 space-y-5">
          <Alert tone="success">{t("verified")}</Alert>
          <Link
            href="/login"
            className="btn-primary inline-flex w-full items-center justify-center"
          >
            {t("backToLogin")}
          </Link>
        </div>
      )}

      {state === "failed" && (
        <div className="mt-8 space-y-5">
          <Alert tone="error">{t("verifyFailed")}</Alert>
          {resendState === "sent" ? (
            <Alert tone="success">{t("resendSent")}</Alert>
          ) : (
            <form onSubmit={onResend} className="space-y-4">
              {resendError && <Alert tone="error">{resendError}</Alert>}
              <div>
                <label htmlFor="companySlug" className="label">
                  {t("companyCode")}
                </label>
                <input
                  id="companySlug"
                  className="input"
                  value={slugInput}
                  onChange={(event) => setSlugInput(event.target.value)}
                  readOnly={companySlug.length > 0}
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
              <button
                type="submit"
                className="btn-primary w-full"
                disabled={resendState === "sending"}
              >
                {resendState === "sending" ? t("sending") : t("resendVerification")}
              </button>
            </form>
          )}
          <Link
            href="/login"
            className="block text-center text-sm font-semibold text-brand-700 hover:text-brand-800"
          >
            {t("backToLogin")}
          </Link>
        </div>
      )}
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailContent />
    </Suspense>
  );
}
