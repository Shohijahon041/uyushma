"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { apiRequest } from "@/lib/client-api";
import { formatDate } from "@/lib/use-api";
import type { DriverProfile } from "@/lib/types";
import { Alert } from "@/components/ui";

type DocumentForm = {
  passportNumber: string;
  passportIssuedBy: string;
  passportIssuedAt: string;
  pinfl: string;
  birthDate: string;
  licenseNumber: string;
  licenseCategories: string;
  licenseIssuedAt: string;
  licenseExpiresAt: string;
};

function formFrom(driver: DriverProfile["driver"]): DocumentForm {
  return {
    passportNumber: driver.passport.number ?? "",
    passportIssuedBy: driver.passport.issuedBy ?? "",
    passportIssuedAt: driver.passport.issuedAt ?? "",
    pinfl: driver.passport.pinfl ?? "",
    birthDate: driver.passport.birthDate ?? "",
    licenseNumber: driver.license.number ?? "",
    licenseCategories: driver.license.categories ?? "",
    licenseIssuedAt: driver.license.issuedAt ?? "",
    licenseExpiresAt: driver.license.expiresAt ?? "",
  };
}

function photoUrl(
  driverId: string,
  kind: "telegram" | "passport" | "license",
  version: string,
  download = false,
) {
  return `/api/proxy/drivers/${driverId}/photo/${kind}?v=${encodeURIComponent(version)}${
    download ? "&download=1" : ""
  }`;
}

function PhotoThumb({
  src,
  alt,
  downloadHref,
  downloadLabel,
}: {
  src: string;
  alt: string;
  downloadHref: string;
  downloadLabel: string;
}) {
  return (
    <div className="space-y-1.5">
      <a href={src} target="_blank" rel="noopener noreferrer" className="block">
        <img
          src={src}
          alt={alt}
          loading="lazy"
          className="h-28 w-40 rounded-lg border border-slate-200 bg-slate-50 object-cover"
        />
      </a>
      <a
        href={downloadHref}
        download
        className="inline-flex items-center text-[11px] font-medium text-blue-600 hover:underline"
      >
        {downloadLabel}
      </a>
    </div>
  );
}

type AvatarDriver = {
  id: string;
  fullName: string;
  telegram: { hasPhoto: boolean; linkedAt: string | null };
};

const avatarSizes = {
  sm: "h-9 w-9 text-xs",
  md: "h-14 w-14 text-base",
  lg: "h-16 w-16 text-lg sm:h-20 sm:w-20",
} as const;

export function DriverAvatar({
  driver,
  size = "md",
}: {
  driver: AvatarDriver;
  size?: keyof typeof avatarSizes;
}) {
  const initials = driver.fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();
  if (!driver.telegram.hasPhoto) {
    return (
      <div
        className={`flex shrink-0 items-center justify-center rounded-full bg-slate-100 font-bold text-slate-500 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700 ${avatarSizes[size]}`}
        aria-hidden="true"
      >
        {initials || "—"}
      </div>
    );
  }
  return (
    <img
      src={photoUrl(driver.id, "telegram", driver.telegram.linkedAt ?? "")}
      alt={`${driver.fullName} — Telegram profil rasmi`}
      loading="lazy"
      className={`shrink-0 rounded-full border border-slate-200 bg-slate-50 object-cover dark:border-slate-700 ${avatarSizes[size]}`}
    />
  );
}

export function DriverDocuments({
  driver,
  onSaved,
}: {
  driver: DriverProfile["driver"];
  onSaved: () => Promise<void>;
}) {
  const t = useTranslations("drivers");
  const tc = useTranslations("common");
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<DocumentForm>(() => formFrom(driver));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(() => String(Date.now()));

  useEffect(() => {
    setForm(formFrom(driver));
    setEditing(false);
    setError(null);
    setVersion(String(Date.now()));
  }, [driver]);

  const initial = formFrom(driver);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const changes = Object.fromEntries(
      (Object.keys(form) as Array<keyof DocumentForm>)
        .filter((key) => form[key].trim() !== initial[key])
        .map((key) => [key, form[key].trim()]),
    );
    if (Object.keys(changes).length === 0) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiRequest(`/drivers/${driver.id}/documents`, { method: "PATCH", body: changes });
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : tc("error"));
    } finally {
      setSaving(false);
    }
  }

  const field = (key: keyof DocumentForm, label: string, type: "text" | "date" = "text", placeholder?: string) => (
    <div>
      <label className="label" htmlFor={`doc-${key}`}>
        {label}
      </label>
      <input
        id={`doc-${key}`}
        type={type}
        className="input"
        value={form[key]}
        placeholder={placeholder}
        onChange={(event) => setForm((previous) => ({ ...previous, [key]: event.target.value }))}
      />
    </div>
  );

  const value = (text: string | null) =>
    text ? <span className="font-medium text-slate-800">{text}</span> : <span className="text-slate-400">—</span>;

  const expired =
    driver.license.expiresAt !== null &&
    new Date(`${driver.license.expiresAt}T23:59:59+05:00`).getTime() < Date.now();

  const telegramName = [driver.telegram.firstName, driver.telegram.lastName].filter(Boolean).join(" ");

  return (
    <div className="mt-6">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-800">{t("documents")}</h3>
        {!editing && (
          <button type="button" className="btn-ghost text-xs" onClick={() => setEditing(true)}>
            {t("editDocuments")}
          </button>
        )}
      </div>

      {driver.telegram.linked && (
        <p className="mb-3 text-xs text-slate-500">
          {t("telegram")}: {telegramName || "—"}
          {driver.telegram.username ? ` · @${driver.telegram.username}` : ""}
          {driver.telegram.linkedAt ? ` · ${formatDate(driver.telegram.linkedAt)}` : ""}
        </p>
      )}

      {editing ? (
        <form onSubmit={submit} className="space-y-4 rounded-xl border border-slate-200 p-4">
          {error && <Alert tone="error">{error}</Alert>}
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("passport")}</p>
          <div className="form-grid">
            {field("passportNumber", t("passportNumber"), "text", "AA1234567")}
            {field("passportIssuedBy", t("passportIssuedBy"))}
            {field("passportIssuedAt", t("issuedAt"), "date")}
            {field("pinfl", t("pinfl"), "text", "14 ta raqam")}
            {field("birthDate", t("birthDate"), "date")}
          </div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("driverLicense")}</p>
          <div className="form-grid">
            {field("licenseNumber", t("license"), "text", "AF1234567")}
            {field("licenseCategories", t("licenseCategories"), "text", "B, C, D")}
            {field("licenseIssuedAt", t("issuedAt"), "date")}
            {field("licenseExpiresAt", t("licenseExpiresAt"), "date")}
          </div>
          <p className="text-[11px] text-slate-400">{t("documentsHint")}</p>
          <div className="flex gap-2">
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? tc("loading") : tc("save")}
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                setForm(initial);
                setEditing(false);
                setError(null);
              }}
            >
              {tc("cancel")}
            </button>
          </div>
        </form>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-200 p-4 text-sm">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{t("passport")}</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="text-slate-500">{t("passportNumber")}</dt>
              <dd className="font-mono">{value(driver.passport.number)}</dd>
              <dt className="text-slate-500">{t("passportIssuedBy")}</dt>
              <dd>{value(driver.passport.issuedBy)}</dd>
              <dt className="text-slate-500">{t("issuedAt")}</dt>
              <dd>{value(driver.passport.issuedAt ? formatDate(driver.passport.issuedAt) : null)}</dd>
              <dt className="text-slate-500">{t("pinfl")}</dt>
              <dd className="font-mono">{value(driver.passport.pinfl)}</dd>
              <dt className="text-slate-500">{t("birthDate")}</dt>
              <dd>{value(driver.passport.birthDate ? formatDate(driver.passport.birthDate) : null)}</dd>
            </dl>
            <div className="mt-3">
              {driver.passport.hasPhoto ? (
                <PhotoThumb
                  src={photoUrl(driver.id, "passport", version)}
                  alt={t("passport")}
                  downloadHref={photoUrl(driver.id, "passport", version, true)}
                  downloadLabel={t("downloadPhoto")}
                />
              ) : (
                <p className="text-[11px] text-slate-400">{t("noPhoto")}</p>
              )}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 p-4 text-sm">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {t("driverLicense")}
            </p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="text-slate-500">{t("license")}</dt>
              <dd className="font-mono">{value(driver.license.number)}</dd>
              <dt className="text-slate-500">{t("licenseCategories")}</dt>
              <dd>{value(driver.license.categories)}</dd>
              <dt className="text-slate-500">{t("issuedAt")}</dt>
              <dd>{value(driver.license.issuedAt ? formatDate(driver.license.issuedAt) : null)}</dd>
              <dt className="text-slate-500">{t("licenseExpiresAt")}</dt>
              <dd>
                {value(driver.license.expiresAt ? formatDate(driver.license.expiresAt) : null)}
                {expired && <span className="ml-2 badge bg-red-50 text-red-700">{t("expired")}</span>}
              </dd>
            </dl>
            <div className="mt-3">
              {driver.license.hasPhoto ? (
                <PhotoThumb
                  src={photoUrl(driver.id, "license", version)}
                  alt={t("driverLicense")}
                  downloadHref={photoUrl(driver.id, "license", version, true)}
                  downloadLabel={t("downloadPhoto")}
                />
              ) : (
                <p className="text-[11px] text-slate-400">{t("noPhoto")}</p>
              )}
            </div>
          </div>
        </div>
      )}
      <p className="mt-2 text-[11px] text-slate-400">{t("botDocumentsHint")}</p>
    </div>
  );
}
