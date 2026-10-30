"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { sessionRegister } from "@/lib/client-api";
import { Alert } from "@/components/ui";

function slugify(value: string): string {
  const map: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "j", з: "z",
    и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
    с: "s", т: "t", у: "u", ф: "f", х: "x", ц: "ts", ч: "ch", ш: "sh",
    щ: "sh", ъ: "", ы: "i", ь: "", э: "e", ю: "yu", я: "ya",
    "o'": "o", "g'": "g", "o‘": "o", "g‘": "g",
  };
  return value
    .toLowerCase()
    .split("")
    .map((char) => map[char] ?? char)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export default function RegisterPage() {
  const t = useTranslations("auth");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [companyName, setCompanyName] = useState("");
  const [companySlug, setCompanySlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);

  function onCompanyNameChange(value: string) {
    setCompanyName(value);
    if (!slugEdited) setCompanySlug(slugify(value));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await sessionRegister({
        companyName,
        companySlug,
        fullName,
        email,
        password,
        ...(phone ? { phone } : {}),
      });
      if ("verificationRequired" in result) {
        setVerificationSent(true);
        setSubmitting(false);
        return;
      }
      router.replace("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : tCommon("error"));
      setSubmitting(false);
    }
  }

  if (verificationSent) {
    return (
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">
          {t("verificationSentTitle")}
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-slate-500">
          {t("verificationSentDescription")}
        </p>
        <Link
          href="/login"
          className="btn-primary mt-8 inline-flex w-full items-center justify-center"
        >
          {t("backToLogin")}
        </Link>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-2xl font-bold tracking-tight text-slate-900">{t("registerTitle")}</h2>
      <p className="mt-1.5 text-sm text-slate-500">{t("registerSubtitle")}</p>

      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <div>
          <label htmlFor="companyName" className="label">
            {t("companyName")}
          </label>
          <input
            id="companyName"
            className="input"
            value={companyName}
            onChange={(event) => onCompanyNameChange(event.target.value)}
            required
          />
        </div>
        <div>
          <label htmlFor="companySlug" className="label">
            {t("companyCode")}
          </label>
          <input
            id="companySlug"
            className="input font-mono"
            value={companySlug}
            onChange={(event) => {
              setSlugEdited(true);
              setCompanySlug(slugify(event.target.value));
            }}
            placeholder={t("companyCodeHint")}
            required
          />
        </div>
        <div>
          <label htmlFor="fullName" className="label">
            {t("fullName")}
          </label>
          <input
            id="fullName"
            className="input"
            autoComplete="name"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
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
          <label htmlFor="phone" className="label">
            {t("phone")}
          </label>
          <input
            id="phone"
            className="input"
            autoComplete="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
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
            autoComplete="new-password"
            minLength={12}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          <p className="mt-1.5 text-xs text-slate-500">{t("passwordHint")}</p>
        </div>
        <button type="submit" className="btn-primary w-full" disabled={submitting}>
          {submitting ? t("registering") : t("register")}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-500">
        {t("hasAccount")}{" "}
        <Link href="/login" className="font-semibold text-brand-700 hover:text-brand-800">
          {t("loginLink")}
        </Link>
      </p>
    </div>
  );
}
