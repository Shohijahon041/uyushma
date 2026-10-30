"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { apiRequest } from "@/lib/client-api";
import { formatDate, formatDateTime, formatMoney, useApi } from "@/lib/use-api";
import type { PlatformOverview } from "@/lib/types";
import { Alert, EmptyState, Loading, PageHeader, StatCard, StatusBadge } from "@/components/ui";

export default function AdminPage() {
  const t = useTranslations("admin");
  const tc = useTranslations("common");
  const { data, loading, error, reload } = useApi<PlatformOverview>("/platform/overview");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionOk, setActionOk] = useState<string | null>(null);

  async function changeStatus(id: string, status: "ACTIVE" | "SUSPENDED") {
    setBusyId(id);
    setActionError(null);
    setActionOk(null);
    try {
      await apiRequest(`/platform/companies/${id}/status`, {
        method: "POST",
        body: { status },
      });
      setActionOk(tc("success"));
      await reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : tc("error"));
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <Loading label={tc("loading")} />;
  if (error) {
    return (
      <>
        <PageHeader title={t("title")} subtitle={t("subtitle")} />
        <Alert tone="error">{error === "Forbidden" ? t("forbidden") : error}</Alert>
      </>
    );
  }
  if (!data) return null;

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      {(actionError || actionOk) && (
        <div className="mb-4">
          <Alert tone={actionError ? "error" : "success"}>{actionError ?? actionOk}</Alert>
        </div>
      )}

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label={t("totalCompanies")} value={data.totals.companies} />
        <StatCard label={t("activeCompanies")} value={data.totals.active} />
        <StatCard label={t("suspendedCompanies")} value={data.totals.suspended} />
        <StatCard label={t("drivers")} value={data.totals.drivers} />
        <StatCard label={t("collected")} value={formatMoney(data.totals.collected)} />
      </div>

      <div className="card">
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-bold text-slate-800">{t("companies")}</h2>
        </div>
        {data.companies.length === 0 ? (
          <EmptyState>{t("empty")}</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("companies")}</th>
                  <th>{t("status")}</th>
                  <th>{t("users")}</th>
                  <th>{t("vehicles")}</th>
                  <th>{t("drivers")}</th>
                  <th>{t("payments")}</th>
                  <th>{t("collected")}</th>
                  <th>{t("plan")}</th>
                  <th>{t("lastSync")}</th>
                  <th>{tc("actions")}</th>
                </tr>
              </thead>
              <tbody>
                {data.companies.map((company) => (
                  <tr key={company.id}>
                    <td>
                      <p className="text-sm font-semibold text-slate-900">{company.name}</p>
                      <p className="font-mono text-[11px] text-slate-400">{company.slug}</p>
                    </td>
                    <td>
                      <StatusBadge status={company.status} label={company.status} />
                    </td>
                    <td>{company.users}</td>
                    <td>{company.vehicles}</td>
                    <td>{company.drivers}</td>
                    <td>{company.payments}</td>
                    <td className="font-semibold text-slate-900">
                      {formatMoney(company.collected)}
                    </td>
                    <td className="text-xs text-slate-600">
                      {company.subscriptionStatus ?? "—"}
                      {company.periodEnd && (
                        <p className="text-[11px] text-slate-400">
                          {formatDate(company.periodEnd)}
                        </p>
                      )}
                    </td>
                    <td className="text-xs text-slate-500">
                      {company.lastSyncAt ? formatDateTime(company.lastSyncAt) : "—"}
                    </td>
                    <td>
                      {company.status === "ACTIVE" ? (
                        <button
                          type="button"
                          className="btn-ghost text-xs text-red-600"
                          disabled={busyId === company.id}
                          onClick={() => void changeStatus(company.id, "SUSPENDED")}
                        >
                          {t("suspend")}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn-ghost text-xs text-emerald-700"
                          disabled={busyId === company.id}
                          onClick={() => void changeStatus(company.id, "ACTIVE")}
                        >
                          {t("activate")}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
