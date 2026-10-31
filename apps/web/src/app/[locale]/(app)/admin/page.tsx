"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { apiRequest } from "@/lib/client-api";
import { formatDate, formatDateTime, formatMoney, useApi } from "@/lib/use-api";
import type {
  LicenseContract,
  PlatformOverview,
  PlatformUser,
  UserRoleName,
} from "@/lib/types";
import { Alert, EmptyState, Loading, PageHeader, StatCard, StatusBadge } from "@/components/ui";

const PLANS = ["START", "PRO", "ENTERPRISE"] as const;
const ROLES: UserRoleName[] = ["OWNER", "ADMIN", "ACCOUNTANT", "MANAGER"];
const METHODS = ["CASH", "BANK_TRANSFER", "CARD", "OTHER"] as const;

type Tab = "companies" | "users" | "licenses";
type Company = PlatformOverview["companies"][number];

interface Credentials {
  companyName: string;
  phone: string;
  password: string;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function form(event: FormEvent<HTMLFormElement>): Record<string, string> {
  const data = new FormData(event.currentTarget);
  const result: Record<string, string> = {};
  data.forEach((value, key) => {
    if (typeof value === "string" && value.trim() !== "") result[key] = value.trim();
  });
  return result;
}

export default function AdminPage() {
  const t = useTranslations("admin");
  const tc = useTranslations("common");
  const locale = useLocale();
  const overview = useApi<PlatformOverview>("/platform/overview");
  const users = useApi<{ items: PlatformUser[] }>("/platform/users");
  const licenses = useApi<{ items: LicenseContract[] }>("/platform/licenses");

  const [tab, setTab] = useState<Tab>("companies");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [copied, setCopied] = useState(false);
  const [showCreateCompany, setShowCreateCompany] = useState(false);
  const [userFormFor, setUserFormFor] = useState<Company | null>(null);
  const [licenseFormFor, setLicenseFormFor] = useState<Company | null>(null);
  const [paymentFormFor, setPaymentFormFor] = useState<Company | null>(null);
  const [paymentMonths, setPaymentMonths] = useState(1);
  const [companyFilter, setCompanyFilter] = useState("");
  const [search, setSearch] = useState("");

  const companies = overview.data?.companies ?? [];
  const companyById = useMemo(
    () => new Map(companies.map((company) => [company.id, company])),
    [companies],
  );

  const filteredUsers = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (users.data?.items ?? []).filter(
      (user) =>
        (!companyFilter || user.companyId === companyFilter) &&
        (!needle ||
          user.fullName.toLowerCase().includes(needle) ||
          (user.phone ?? "").replace(/\s/g, "").includes(needle.replace(/\s/g, "")) ||
          user.companySlug.includes(needle)),
    );
  }, [users.data, companyFilter, search]);

  async function reloadAll() {
    await Promise.all([overview.reload(), users.reload(), licenses.reload()]);
  }

  async function run(key: string, action: () => Promise<void>) {
    setBusy(key);
    setMessage(null);
    try {
      await action();
      await reloadAll();
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof Error ? err.message : tc("error") });
    } finally {
      setBusy(null);
    }
  }

  function showCredentials(next: Credentials) {
    setCopied(false);
    setCredentials(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function copyCredentials() {
    if (!credentials) return;
    const text = [
      `${t("loginUrl")}: ${window.location.origin}/${locale}/login`,
      `${t("phone")}: ${credentials.phone}`,
      `${t("password")}: ${credentials.password}`,
    ].join("\n");
    await navigator.clipboard.writeText(text);
    setCopied(true);
  }

  function createCompany(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = form(event);
    const target = event.currentTarget;
    void run("create-company", async () => {
      const result = await apiRequest<{
        company: { name: string; slug: string };
        owner: { phone: string };
        password: string;
      }>("/platform/companies", { method: "POST", body });
      target.reset();
      setShowCreateCompany(false);
      showCredentials({
        companyName: result.company.name,
        phone: result.owner.phone,
        password: result.password,
      });
    });
  }

  function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!userFormFor) return;
    const company = userFormFor;
    const body = form(event);
    void run("create-user", async () => {
      const result = await apiRequest<{ user: { phone: string }; password: string }>(
        `/platform/companies/${company.id}/users`,
        { method: "POST", body },
      );
      setUserFormFor(null);
      showCredentials({
        companyName: company.name,
        phone: result.user.phone,
        password: result.password,
      });
    });
  }

  function createLicense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!licenseFormFor) return;
    const company = licenseFormFor;
    const body = form(event);
    void run("create-license", async () => {
      await apiRequest(`/platform/companies/${company.id}/licenses`, { method: "POST", body });
      setLicenseFormFor(null);
      setTab("licenses");
      setMessage({ tone: "success", text: t("licenseSaved") });
    });
  }

  function changeStatus(company: Company, status: "ACTIVE" | "SUSPENDED") {
    if (status === "SUSPENDED" && !window.confirm(t("confirmSuspend", { name: company.name }))) {
      return;
    }
    void run(`status-${company.id}`, async () => {
      await apiRequest(`/platform/companies/${company.id}/status`, {
        method: "POST",
        body: { status },
      });
      setMessage({ tone: "success", text: tc("success") });
    });
  }

  function updateUser(
    user: PlatformUser,
    body: { role?: UserRoleName; isActive?: boolean; phone?: string },
  ) {
    void run(`user-${user.id}`, async () => {
      await apiRequest(`/platform/companies/${user.companyId}/users/${user.id}`, {
        method: "PATCH",
        body,
      });
      setMessage({ tone: "success", text: tc("success") });
    });
  }

  function editPhone(user: PlatformUser) {
    const next = window.prompt(t("enterPhone", { name: user.fullName }), user.phone ?? "+998");
    if (!next || next.trim() === (user.phone ?? "")) return;
    updateUser(user, { phone: next.trim() });
  }

  function resetPassword(user: PlatformUser) {
    if (!user.phone) {
      setMessage({ tone: "error", text: t("phoneRequiredFirst") });
      return;
    }
    if (!window.confirm(t("confirmReset", { name: user.fullName }))) return;
    const disableTwoFactor = user.twoFactorEnabled && window.confirm(t("confirmDisable2fa"));
    void run(`reset-${user.id}`, async () => {
      const result = await apiRequest<{ password: string }>(
        `/platform/companies/${user.companyId}/users/${user.id}/reset-password`,
        { method: "POST", body: { disableTwoFactor } },
      );
      showCredentials({
        companyName: user.companyName,
        phone: user.phone ?? "",
        password: result.password,
      });
    });
  }

  function openForm(company: Company, kind: "user" | "license" | "payment") {
    setUserFormFor(kind === "user" ? company : null);
    setLicenseFormFor(kind === "license" ? company : null);
    setPaymentFormFor(kind === "payment" ? company : null);
    setPaymentMonths(1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function recordPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!paymentFormFor) return;
    const company = paymentFormFor;
    const body = { ...form(event), months: paymentMonths };
    void run("record-payment", async () => {
      const result = await apiRequest<{ total: string; paidUntil: string | null }>(
        `/platform/companies/${company.id}/subscription-payments`,
        { method: "POST", body },
      );
      setPaymentFormFor(null);
      setMessage({
        tone: "success",
        text: t("paymentRecorded", {
          total: formatMoney(result.total),
          until: result.paidUntil ? formatDate(result.paidUntil) : "—",
        }),
      });
    });
  }

  if (overview.loading) return <Loading label={tc("loading")} />;
  if (overview.error) {
    return (
      <>
        <PageHeader title={t("title")} subtitle={t("subtitle")} />
        <Alert tone="error">
          {overview.error === "Forbidden" ? t("forbidden") : overview.error}
        </Alert>
      </>
    );
  }
  if (!overview.data) return null;
  const totals = overview.data.totals;

  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        action={
          <button
            type="button"
            className="btn-primary"
            onClick={() => setShowCreateCompany((value) => !value)}
          >
            {showCreateCompany ? tc("cancel") : t("newCompany")}
          </button>
        }
      />

      {credentials && (
        <div className="mb-5 rounded-2xl border border-amber-300 bg-amber-50 p-5 text-amber-900">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold">{t("credentialsTitle")}</h2>
              <p className="mt-1 text-xs opacity-80">{t("credentialsHint")}</p>
            </div>
            <div className="flex gap-2">
              <button type="button" className="btn-secondary text-xs" onClick={() => void copyCredentials()}>
                {copied ? t("copied") : t("copy")}
              </button>
              <button type="button" className="btn-ghost text-xs" onClick={() => setCredentials(null)}>
                {t("close")}
              </button>
            </div>
          </div>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs opacity-70">{t("companies")}</dt>
              <dd className="font-semibold">{credentials.companyName}</dd>
            </div>
            <div>
              <dt className="text-xs opacity-70">{t("loginPhone")}</dt>
              <dd className="font-mono font-semibold">{credentials.phone}</dd>
            </div>
            <div>
              <dt className="text-xs opacity-70">{t("password")}</dt>
              <dd className="font-mono text-base font-bold tracking-wide">{credentials.password}</dd>
            </div>
          </dl>
        </div>
      )}

      {message && (
        <div className="mb-4">
          <Alert tone={message.tone}>{message.text}</Alert>
        </div>
      )}

      {showCreateCompany && (
        <form className="card card-body mb-5" onSubmit={createCompany}>
          <h2 className="mb-1 text-sm font-bold text-slate-800">{t("newCompany")}</h2>
          <p className="mb-4 text-xs text-slate-500">{t("newCompanyHint")}</p>
          <div className="form-grid">
            <label>
              <span className="label">{t("companyName")}</span>
              <input name="companyName" className="input" required minLength={2} maxLength={200} />
            </label>
            <label>
              <span className="label">{t("companyCodeOptional")}</span>
              <input
                name="companySlug"
                className="input font-mono"
                minLength={3}
                maxLength={64}
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                placeholder={t("companyCodeAuto")}
              />
            </label>
            <label>
              <span className="label">{t("ownerName")}</span>
              <input name="ownerFullName" className="input" required minLength={2} maxLength={160} />
            </label>
            <label>
              <span className="label">{t("ownerPhone")}</span>
              <input
                name="ownerPhone"
                type="tel"
                className="input font-mono"
                required
                defaultValue="+998 "
                placeholder="+998 90 123 45 67"
              />
            </label>
            <label>
              <span className="label">{t("plan")}</span>
              <select name="planId" className="select" defaultValue="START">
                {PLANS.map((plan) => (
                  <option key={plan} value={plan}>
                    {plan}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-full">
              <span className="label">{t("passwordOptional")}</span>
              <input name="password" type="text" className="input font-mono" minLength={12} autoComplete="off" />
            </label>
          </div>
          <div className="mt-4 flex justify-end">
            <button type="submit" className="btn-primary" disabled={busy === "create-company"}>
              {busy === "create-company" ? t("saving") : t("createCompany")}
            </button>
          </div>
        </form>
      )}

      {userFormFor && (
        <form className="card card-body mb-5" onSubmit={createUser}>
          <h2 className="mb-4 text-sm font-bold text-slate-800">
            {t("newUserFor", { name: userFormFor.name })}
          </h2>
          <div className="form-grid">
            <label>
              <span className="label">{t("fullName")}</span>
              <input name="fullName" className="input" required minLength={2} maxLength={160} />
            </label>
            <label>
              <span className="label">{t("loginPhone")}</span>
              <input
                name="phone"
                type="tel"
                className="input font-mono"
                required
                defaultValue="+998 "
                placeholder="+998 90 123 45 67"
              />
            </label>
            <label>
              <span className="label">{t("role")}</span>
              <select name="role" className="select" defaultValue="OWNER">
                {ROLES.map((role) => (
                  <option key={role} value={role}>
                    {t(`role_${role}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-full">
              <span className="label">{t("passwordOptional")}</span>
              <input name="password" type="text" className="input font-mono" minLength={12} autoComplete="off" />
            </label>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setUserFormFor(null)}>
              {tc("cancel")}
            </button>
            <button type="submit" className="btn-primary" disabled={busy === "create-user"}>
              {busy === "create-user" ? t("saving") : t("createUser")}
            </button>
          </div>
        </form>
      )}

      {licenseFormFor && (
        <form className="card card-body mb-5" onSubmit={createLicense}>
          <h2 className="mb-1 text-sm font-bold text-slate-800">
            {t("newLicenseFor", { name: licenseFormFor.name })}
          </h2>
          <p className="mb-4 text-xs text-slate-500">{t("licenseHint")}</p>
          <div className="form-grid">
            <label>
              <span className="label">{t("plan")}</span>
              <select name="planId" className="select" defaultValue="ENTERPRISE">
                {PLANS.map((plan) => (
                  <option key={plan} value={plan}>
                    {plan}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="label">{t("amount")}</span>
              <input
                name="amount"
                className="input"
                required
                inputMode="decimal"
                pattern="\d{1,16}(\.\d{1,2})?"
                placeholder="1500000"
              />
            </label>
            <label>
              <span className="label">{t("signedAt")}</span>
              <input name="signedAt" type="date" className="input" required defaultValue={todayIso()} />
            </label>
            <label>
              <span className="label">{t("contractNumber")}</span>
              <input name="number" className="input font-mono" maxLength={40} placeholder={t("autoNumber")} />
            </label>
            <label className="field-full">
              <span className="label">{t("note")}</span>
              <input name="note" className="input" maxLength={500} />
            </label>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setLicenseFormFor(null)}>
              {tc("cancel")}
            </button>
            <button type="submit" className="btn-primary" disabled={busy === "create-license"}>
              {busy === "create-license" ? t("saving") : t("createLicense")}
            </button>
          </div>
        </form>
      )}

      {paymentFormFor && (
        <form className="card card-body mb-5" onSubmit={recordPayment}>
          <h2 className="mb-1 text-sm font-bold text-slate-800">
            {t("paymentFor", { name: paymentFormFor.name })}
          </h2>
          <p className="mb-4 text-xs text-slate-500">{t("paymentHint")}</p>
          <div className="mb-4 flex flex-wrap gap-4 text-sm text-slate-600">
            <span>
              {t("monthlyFee")}:{" "}
              <b className="text-slate-900">{formatMoney(paymentFormFor.monthlyFee ?? "0")}</b>
            </span>
            <span>
              {t("paidUntil")}:{" "}
              <b className="text-slate-900">
                {paymentFormFor.periodEnd ? formatDate(paymentFormFor.periodEnd) : "—"}
              </b>
            </span>
            {Number(paymentFormFor.unpaidTotal) > 0 && (
              <span className="text-red-600">
                {t("debt")}: <b>{formatMoney(paymentFormFor.unpaidTotal)}</b> ({paymentFormFor.unpaidCount})
              </span>
            )}
          </div>
          <div className="form-grid">
            <label>
              <span className="label">{t("months")}</span>
              <select
                className="select"
                value={paymentMonths}
                onChange={(event) => setPaymentMonths(Number(event.target.value))}
              >
                {Array.from({ length: 12 }, (_, index) => index + 1).map((count) => (
                  <option key={count} value={count}>
                    {t("monthsCount", { count })}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="label">{t("paymentMethod")}</span>
              <select name="paymentMethod" className="select" defaultValue="BANK_TRANSFER">
                {METHODS.map((method) => (
                  <option key={method} value={method}>
                    {t(`method_${method}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-full">
              <span className="label">{t("note")}</span>
              <input name="note" className="input" maxLength={500} />
            </label>
          </div>
          <p className="mt-3 text-sm text-slate-600">
            {t("paymentTotal")}:{" "}
            <b className="text-slate-900">
              {formatMoney((Number(paymentFormFor.monthlyFee ?? 0) * paymentMonths).toFixed(2))}
            </b>
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setPaymentFormFor(null)}>
              {tc("cancel")}
            </button>
            <button type="submit" className="btn-primary" disabled={busy === "record-payment"}>
              {busy === "record-payment" ? t("saving") : t("savePayment")}
            </button>
          </div>
        </form>
      )}

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard tone="blue" label={t("totalCompanies")} value={totals.companies} />
        <StatCard tone="emerald" label={t("activeCompanies")} value={totals.active} />
        <StatCard tone="red" label={t("suspendedCompanies")} value={totals.suspended} />
        <StatCard tone="amber" label={t("contractCompanies")} value={totals.contracts} />
        <StatCard tone="emerald" label={t("monthlyRevenue")} value={formatMoney(totals.monthlyRevenue)} />
        <StatCard tone="red" label={t("unpaidTotal")} value={formatMoney(totals.unpaid)} />
        <StatCard tone="violet" label={t("users")} value={totals.users} />
        <StatCard tone="emerald" label={t("collected")} value={formatMoney(totals.collected)} />
      </div>

      <div className="mb-4 inline-flex rounded-xl border border-slate-200 bg-white p-1">
        {(["companies", "users", "licenses"] as Tab[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
              tab === key ? "bg-brand-600 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            {t(`tab_${key}`)}
          </button>
        ))}
      </div>

      {tab === "companies" && (
        <div className="card">
          {companies.length === 0 ? (
            <EmptyState>{t("empty")}</EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t("companies")}</th>
                    <th>{t("status")}</th>
                    <th>{t("plan")}</th>
                    <th>{t("users")}</th>
                    <th>{t("vehicles")}</th>
                    <th>{t("drivers")}</th>
                    <th>{t("collected")}</th>
                    <th>{t("lastSync")}</th>
                    <th>{tc("actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {companies.map((company) => (
                    <tr key={company.id}>
                      <td>
                        <p className="text-sm font-semibold text-slate-900">{company.name}</p>
                        <p className="font-mono text-[11px] text-slate-400">{company.slug}</p>
                      </td>
                      <td>
                        <StatusBadge status={company.status} label={t(`companyStatus_${company.status}`)} />
                      </td>
                      <td className="text-xs text-slate-600">
                        <p className="font-semibold text-slate-800">{company.planId ?? "—"}</p>
                        {company.hasContract && (
                          <span className="badge mt-1 bg-amber-100 text-amber-800">
                            {t("contract")} · {formatMoney(company.monthlyFee ?? "0")} / {t("perMonth")}
                          </span>
                        )}
                        <p className="text-[11px] text-slate-400">
                          {company.subscriptionStatus ?? "—"}
                          {company.periodEnd && ` · ${t("paidUntil")}: ${formatDate(company.periodEnd)}`}
                        </p>
                        {Number(company.unpaidTotal) > 0 && (
                          <p className="text-[11px] font-semibold text-red-600">
                            {t("debt")}: {formatMoney(company.unpaidTotal)}
                          </p>
                        )}
                      </td>
                      <td>{company.users}</td>
                      <td>{company.vehicles}</td>
                      <td>{company.drivers}</td>
                      <td className="font-semibold text-slate-900">{formatMoney(company.collected)}</td>
                      <td className="text-xs text-slate-500">
                        {company.lastSyncAt ? formatDateTime(company.lastSyncAt) : "—"}
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          <button
                            type="button"
                            className="btn-ghost text-xs text-brand-700"
                            onClick={() => openForm(company, "user")}
                          >
                            {t("addUser")}
                          </button>
                          <button
                            type="button"
                            className="btn-ghost text-xs text-amber-700"
                            onClick={() => openForm(company, "license")}
                          >
                            {t("addLicense")}
                          </button>
                          <button
                            type="button"
                            className="btn-ghost text-xs text-emerald-700"
                            onClick={() => openForm(company, "payment")}
                          >
                            {t("recordPayment")}
                          </button>
                          <button
                            type="button"
                            className="btn-ghost text-xs"
                            onClick={() => {
                              setCompanyFilter(company.id);
                              setTab("users");
                            }}
                          >
                            {t("viewUsers")}
                          </button>
                          {company.status === "ACTIVE" ? (
                            <button
                              type="button"
                              className="btn-ghost text-xs text-red-600"
                              disabled={busy === `status-${company.id}`}
                              onClick={() => changeStatus(company, "SUSPENDED")}
                            >
                              {t("suspend")}
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="btn-ghost text-xs text-emerald-700"
                              disabled={busy === `status-${company.id}`}
                              onClick={() => changeStatus(company, "ACTIVE")}
                            >
                              {t("activate")}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "users" && (
        <div className="card">
          <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row">
            <select
              className="select sm:max-w-xs"
              value={companyFilter}
              onChange={(event) => setCompanyFilter(event.target.value)}
            >
              <option value="">{t("allCompanies")}</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
            <input
              className="input sm:max-w-sm"
              placeholder={t("searchUsers")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          {users.loading ? (
            <Loading label={tc("loading")} />
          ) : filteredUsers.length === 0 ? (
            <EmptyState>{t("noUsers")}</EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t("fullName")}</th>
                    <th>{t("companies")}</th>
                    <th>{t("role")}</th>
                    <th>{t("status")}</th>
                    <th>2FA</th>
                    <th>{t("lastLogin")}</th>
                    <th>{tc("actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((user) => (
                    <tr key={user.id}>
                      <td>
                        <p className="text-sm font-semibold text-slate-900">
                          {user.fullName}
                        </p>
                        <p className="font-mono text-[11px] text-slate-500">
                          {user.phone ?? <span className="text-red-500">{t("noPhone")}</span>}
                        </p>
                      </td>
                      <td className="text-xs">
                        <p className="font-semibold text-slate-800">
                          {companyById.get(user.companyId)?.name ?? user.companyName}
                        </p>
                        <p className="font-mono text-[11px] text-slate-400">{user.companySlug}</p>
                      </td>
                      <td>
                        <select
                          className="select py-1.5 text-xs"
                          value={user.role}
                          disabled={busy === `user-${user.id}`}
                          onChange={(event) =>
                            updateUser(user, { role: event.target.value as UserRoleName })
                          }
                        >
                          {ROLES.map((role) => (
                            <option key={role} value={role}>
                              {t(`role_${role}`)}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <StatusBadge
                          status={user.isActive ? "ACTIVE" : "INACTIVE"}
                          label={user.isActive ? t("userActive") : t("userBlocked")}
                        />
                      </td>
                      <td className="text-xs">{user.twoFactorEnabled ? t("on") : t("off")}</td>
                      <td className="text-xs text-slate-500">
                        {user.lastLoginAt ? formatDateTime(user.lastLoginAt) : t("never")}
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          <button
                            type="button"
                            className="btn-ghost text-xs"
                            disabled={busy === `user-${user.id}`}
                            onClick={() => editPhone(user)}
                          >
                            {t("editPhone")}
                          </button>
                          <button
                            type="button"
                            className="btn-ghost text-xs text-brand-700"
                            disabled={busy === `reset-${user.id}`}
                            onClick={() => resetPassword(user)}
                          >
                            {t("resetPassword")}
                          </button>
                          {user.isActive ? (
                              <button
                                type="button"
                                className="btn-ghost text-xs text-red-600"
                                disabled={busy === `user-${user.id}`}
                                onClick={() => updateUser(user, { isActive: false })}
                              >
                                {t("block")}
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="btn-ghost text-xs text-emerald-700"
                                disabled={busy === `user-${user.id}`}
                                onClick={() => updateUser(user, { isActive: true })}
                              >
                                {t("unblock")}
                              </button>
                            )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "licenses" && (
        <div className="card">
          <div className="border-b border-slate-100 px-4 py-3">
            <p className="text-xs text-slate-500">{t("licenseHint")}</p>
          </div>
          {licenses.loading ? (
            <Loading label={tc("loading")} />
          ) : (licenses.data?.items ?? []).length === 0 ? (
            <EmptyState>{t("noLicenses")}</EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t("contractNumber")}</th>
                    <th>{t("companies")}</th>
                    <th>{t("plan")}</th>
                    <th>{t("amount")}</th>
                    <th>{t("signedAt")}</th>
                  </tr>
                </thead>
                <tbody>
                  {(licenses.data?.items ?? []).map((license) => (
                    <tr key={license.id}>
                      <td>
                        <p className="font-mono text-sm font-semibold text-slate-900">{license.number}</p>
                        {license.note && <p className="text-[11px] text-slate-400">{license.note}</p>}
                      </td>
                      <td className="text-sm">{license.companyName}</td>
                      <td className="text-sm font-semibold">{license.planId}</td>
                      <td className="font-semibold text-slate-900">
                        {formatMoney(license.amount)} / {t("perMonth")}
                      </td>
                      <td className="text-xs">{formatDate(license.signedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  );
}
