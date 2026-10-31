"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useApi, formatMoney, formatDate, formatDateTime } from "@/lib/use-api";
import type { DashboardSummary } from "@/lib/types";
import {
  Alert,
  EmptyState,
  Loading,
  PageHeader,
  StatCard,
  StatusBadge,
} from "@/components/ui";

export default function DashboardPage() {
  const t = useTranslations("dashboard");
  const tc = useTranslations("common");
  const ts = useTranslations("payments");
  const tsub = useTranslations("subscription");
  const { data, loading, error, reload } = useApi<DashboardSummary>("/dashboard/summary");

  if (loading) return <Loading label={tc("loading")} />;
  if (error) return <Alert tone="error">{error}</Alert>;
  if (!data) return null;

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard tone="blue" label={t("vehicles")} value={data.counts.vehicles} />
        <StatCard tone="emerald" label={t("activeContracts")} value={data.counts.activeContracts} />
        <StatCard tone="violet" label={t("routes")} value={data.counts.routes} />
        <StatCard tone="amber" label={t("users")} value={data.counts.users} />
      </div>

      <div className="card card-body mt-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-slate-800">{t("externalTitle")}</h2>
            <p className="mt-1 text-xs text-slate-500">
              {data.external.lastSyncAt
                ? t("externalLastSync", { date: formatDateTime(data.external.lastSyncAt) })
                : t("externalNeverSynced")}
            </p>
          </div>
          <Link href="/registry" className="btn-secondary text-xs">
            {t("openRegistry")}
          </Link>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[
            { label: t("externalVehicles"), value: data.external.vehicles },
            { label: t("externalContracts"), value: data.external.records.CONTRACT },
            {
              label: t("externalCertificates"),
              value: data.external.records.CERTIFICATE,
            },
            {
              label: t("externalApplications"),
              value: data.external.records.CONTRACT_APPLICATION,
            },
            { label: t("externalTenders"), value: data.external.records.TENDER_APPLICATION },
          ].map((item) => (
            <div
              key={item.label}
              className="rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2"
            >
              <p className="text-lg font-bold text-slate-900">{item.value}</p>
              <p className="text-[11px] text-slate-500">{item.label}</p>
            </div>
          ))}
        </div>
        {data.external.expiringCertificates > 0 && (
          <p className="mt-3 text-xs font-medium text-amber-600">
            {t("expiringCertificates", { count: data.external.expiringCertificates })}
          </p>
        )}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="card card-body relative overflow-hidden border-l-4 border-l-amber-400 lg:col-span-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {t("pendingPayments")}
          </p>
          <div className="mt-1 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-3xl font-bold tracking-tight text-slate-900">
                {formatMoney(data.payments.pendingAmount)}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {data.payments.pendingCount} ta to'lov kutilmoqda
              </p>
            </div>
            <Link href="/payments" className="btn-secondary text-xs">
              {t("goToPayments")}
            </Link>
          </div>
        </div>
        <div className="card card-body border-l-4 border-l-emerald-500">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {t("paidThisMonth")}
          </p>
          <p className="mt-2 text-2xl font-bold tracking-tight text-emerald-700">
            {formatMoney(data.payments.paidThisMonth)}
          </p>
          <p className="mt-1 text-xs text-slate-500">{ts("manualNote")}</p>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="card lg:col-span-2">
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="text-sm font-bold text-slate-800">{t("recentPayments")}</h2>
          </div>
          {data.payments.recent.length === 0 ? (
            <EmptyState>{t("noPayments")}</EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t("plate")}</th>
                    <th>{t("owner")}</th>
                    <th>{tc("amount")}</th>
                    <th>{tc("status")}</th>
                    <th>{tc("date")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.payments.recent.map((payment) => (
                    <tr key={payment.id}>
                      <td className="font-semibold text-slate-900">{payment.vehicle}</td>
                      <td>{payment.owner}</td>
                      <td className="whitespace-nowrap font-medium">{formatMoney(payment.amount)}</td>
                      <td>
                        <StatusBadge status={payment.status} label={ts(payment.status)} />
                      </td>
                      <td className="whitespace-nowrap text-slate-500">
                        {formatDate(payment.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card card-body">
          <h2 className="text-sm font-bold text-slate-800">{t("subscription")}</h2>
          {data.subscription ? (
            <div className="mt-4 space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">{t("plan")}</span>
                <span className="font-semibold text-slate-900">{data.subscription.planName}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">{tc("status")}</span>
                <StatusBadge
                  status={data.subscription.status}
                  label={tsub(data.subscription.status)}
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">
                  {data.subscription.status === "TRIAL" ? t("trialUntil") : tsub("paidUntil")}
                </span>
                <span className="font-medium text-slate-800">
                  {formatDate(data.subscription.currentPeriodEnd)}
                </span>
              </div>
              {data.subscription.monthlyFee && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">
                    {data.subscription.hasContract ? tsub("contract") : tsub("plan")}
                  </span>
                  <span className="font-medium text-slate-800">
                    {formatMoney(data.subscription.monthlyFee)} / {tsub("monthly")}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-slate-500">{t("openInvoices")}</span>
                <span className="font-medium text-slate-800">
                  {data.subscription.openInvoices}
                </span>
              </div>
              <Link href="/subscription" className="btn-secondary mt-2 w-full text-xs">
                {t("subscription")}
              </Link>
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-500">Faol obuna topilmadi.</p>
          )}
          <button
            type="button"
            onClick={() => void reload()}
            className="mt-4 text-xs font-semibold text-brand-700 hover:text-brand-800"
          >
            {tc("refresh")}
          </button>
        </div>
      </div>
    </>
  );
}
