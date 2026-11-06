"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useApi, formatMoney, formatDate, formatDateTime } from "@/lib/use-api";
import type { DashboardSummary } from "@/lib/types";
import { Alert, EmptyState, PageHeader, Skeleton, StatCard, StatusBadge } from "@/components/ui";
import { Icon } from "@/components/icons";
import { formatUzPlate } from "@/lib/plate";

export default function DashboardPage() {
  const t = useTranslations("dashboard");
  const tc = useTranslations("common");
  const ts = useTranslations("payments");
  const tsub = useTranslations("subscription");
  const { data, loading, error, reload } = useApi<DashboardSummary>("/dashboard/summary");
  const { data: radarData } = useApi<{
    totals: {
      totalVehicles: number;
      fullyCompliant: number;
      partial: number;
      expired: number;
      noRentContract: number;
      expiringSoon15?: number;
      expiringSoon30?: number;
    };
  }>("/registry/cross-link");

  if (loading) {
    return (
      <>
        <PageHeader title={t("title")} subtitle={t("subtitle")} />
        <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
          {[0, 1, 2, 3].map((key) => (
            <div key={key} className="card card-body">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-3 h-7 w-16" />
            </div>
          ))}
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {[0, 1].map((key) => (
            <div key={key} className="card card-body">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="mt-3 h-7 w-20" />
            </div>
          ))}
        </div>
        <div className="mt-4 card card-body">
          <Skeleton className="h-4 w-40" />
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {[0, 1, 2, 3, 4].map((key) => (
              <Skeleton key={key} className="h-16 w-full" />
            ))}
          </div>
        </div>
      </>
    );
  }

  if (error) {
    return (
      <>
        <PageHeader title={t("title")} subtitle={t("subtitle")} />
        <div className="card card-body flex flex-col items-start gap-3">
          <Alert tone="error">{error}</Alert>
          <button type="button" className="btn-secondary" onClick={() => void reload()}>
            {tc("retry")}
          </button>
        </div>
      </>
    );
  }
  if (!data) return null;

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard tone="blue" label={t("vehicles")} value={data.counts.vehicles} />
        <StatCard tone="emerald" label={t("activeContracts")} value={data.counts.activeContracts} />
        <StatCard tone="violet" label={t("routes")} value={data.counts.routes} />
        <StatCard tone="amber" label={t("users")} value={data.counts.users} />
      </div>

      <div className="mt-4">
        <h2 className="mb-2 text-sm font-bold text-slate-800">{t("driversToday")}</h2>
        <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
          <StatCard
            tone="emerald"
            label={t("workedToday")}
            value={data.drivers.workedToday}
            hint={`${t("assignedToday")}: ${data.drivers.assignedToday}`}
          />
          <StatCard
            tone="amber"
            label={t("paidForTomorrow")}
            value={data.drivers.paidForTomorrow}
            hint={t("workedHint")}
          />
        </div>
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
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
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

      {/* 360° Huquqiy Nazorat va Xavf Radari */}
      {radarData?.totals && radarData.totals.totalVehicles > 0 && (
        <div className="card card-body mt-4 border-l-4 border-l-indigo-600">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300">
                  <Icon name="shield" className="h-5 w-5" />
                </span>
                <h2 className="text-sm font-bold text-slate-800">
                  360° Huquqiy Nazorat va Hujjatlar Xavf Radari
                </h2>
              </div>
              <p className="mt-0.5 text-xs text-slate-500">
                Soliq ijara (ijara.soliq.uz) va E-Tender litsenziyalarining (uztrans.uz) amal qilish muddati monitoringi
              </p>
            </div>
            <Link
              href="/registry"
              className="btn-primary flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold"
            >
              <span>Reyestrga o&apos;tish</span>
              <span>→</span>
            </Link>
          </div>

          <div className="mt-4 grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-emerald-800">To&apos;liq qonuniy</span>
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                  <Icon name="check" className="h-3.5 w-3.5" />
                </span>
              </div>
              <p className="mt-2 text-2xl font-black text-emerald-700 tabular-nums">
                {radarData.totals.fullyCompliant}
              </p>
              <p className="text-[11px] text-emerald-600 mt-0.5 font-medium">
                {Math.round((radarData.totals.fullyCompliant / radarData.totals.totalVehicles) * 100)}% qamrov
              </p>
            </div>

            <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-rose-800">Jarima xavfi</span>
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-rose-100 text-rose-700">
                  <Icon name="alert" className="h-3.5 w-3.5" />
                </span>
              </div>
              <p className="mt-2 text-2xl font-black text-rose-700 tabular-nums">
                {radarData.totals.expired}
              </p>
              <p className="text-[11px] text-rose-600 mt-0.5 font-medium">
                Muddati o&apos;tgan
              </p>
            </div>

            <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-amber-800">15 kun qolgan</span>
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 text-amber-700">
                  <Icon name="clock" className="h-3.5 w-3.5" />
                </span>
              </div>
              <p className="mt-2 text-2xl font-black text-amber-700 tabular-nums">
                {radarData.totals.expiringSoon15 ?? 0}
              </p>
              <p className="text-[11px] text-amber-600 mt-0.5 font-medium">
                Zudlik bilan yangilash
              </p>
            </div>

            <div className="rounded-xl border border-yellow-200 bg-yellow-50/60 p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-yellow-800">30 kun qolgan</span>
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-yellow-100 text-yellow-700">
                  <Icon name="clock" className="h-3.5 w-3.5" />
                </span>
              </div>
              <p className="mt-2 text-2xl font-black text-yellow-700 tabular-nums">
                {radarData.totals.expiringSoon30 ?? 0}
              </p>
              <p className="text-[11px] text-yellow-600 mt-0.5 font-medium">
                Rejadagi yangilanish
              </p>
            </div>

            <div className="rounded-xl border border-orange-200 bg-orange-50/60 p-3 col-span-2 sm:col-span-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-orange-800">Soliq ijarasi yo&apos;q</span>
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-orange-100 text-orange-700">
                  <Icon name="ban" className="h-3.5 w-3.5" />
                </span>
              </div>
              <p className="mt-2 text-2xl font-black text-orange-700 tabular-nums">
                {radarData.totals.noRentContract}
              </p>
              <p className="text-[11px] text-orange-600 mt-0.5 font-medium">
                Ro&apos;yxatdan o&apos;tmagan
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="card card-body relative overflow-hidden border-l-4 border-l-amber-400 lg:col-span-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {t("pendingPayments")}
          </p>
          <div className="mt-1 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-3xl font-bold tracking-tight text-slate-900 tabular-nums">
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
          <p className="mt-2 text-2xl font-bold tracking-tight text-emerald-700 tabular-nums">
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
            <>
              {/* Mobil: kartochka ko'rinishi */}
              <ul className="divide-y divide-slate-100 sm:hidden">
                {data.payments.recent.map((payment) => (
                  <li
                    key={payment.id}
                    className="flex items-start justify-between gap-3 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="font-mono text-sm font-semibold text-slate-900">
                        {formatUzPlate(payment.vehicle)}
                      </p>
                      <p className="truncate text-xs text-slate-500">{payment.owner}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <StatusBadge status={payment.status} label={ts(payment.status)} />
                        <span className="text-[11px] text-slate-400">
                          {formatDate(payment.createdAt)}
                        </span>
                      </div>
                    </div>
                    <p className="shrink-0 text-sm font-bold tabular-nums text-slate-900">
                      {formatMoney(payment.amount)}
                    </p>
                  </li>
                ))}
              </ul>

              {/* Desktop: jadval */}
              <div className="table-wrap hidden sm:block">
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
                        <td className="font-mono font-semibold text-slate-900">
                          {formatUzPlate(payment.vehicle)}
                        </td>
                        <td>{payment.owner}</td>
                        <td className="whitespace-nowrap font-medium tabular-nums">
                          {formatMoney(payment.amount)}
                        </td>
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
            </>
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
