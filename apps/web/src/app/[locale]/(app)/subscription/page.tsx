"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { apiRequest } from "@/lib/client-api";
import { formatDate, formatMoney, useApi } from "@/lib/use-api";
import type { AuthUser, Plan, Subscription } from "@/lib/types";
import { Alert, EmptyState, Loading, PageHeader, StatusBadge } from "@/components/ui";

export default function SubscriptionPage() {
  const t = useTranslations("subscription");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { data, loading, error, reload } = useApi<{ subscription: Subscription | null }>(
    "/subscriptions/current",
  );
  const plans = useApi<{ items: Plan[] }>("/plans");
  const me = useApi<AuthUser>("/auth/me");
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const isOwner = me.data?.role === "OWNER";

  async function changePlan(planId: string) {
    setActionError(null);
    setActionSuccess(null);
    setBusy(planId);
    try {
      await apiRequest("/subscriptions/change-plan", {
        method: "POST",
        body: { planId },
      });
      setActionSuccess("Obuna rejasi yangilandi.");
      await reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : tc("error"));
    } finally {
      setBusy(null);
    }
  }

  async function generateInvoice() {
    setActionError(null);
    setActionSuccess(null);
    setBusy("invoice");
    try {
      const result = await apiRequest<{ created: boolean; number?: string }>(
        "/subscriptions/invoices/generate",
        { method: "POST", body: {} },
      );
      setActionSuccess(
        result.created ? `Hisob-faktura yaratildi: ${result.number ?? ""}` : "Hisob allaqachon mavjud.",
      );
      await reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : tc("error"));
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <Loading label={tc("loading")} />;
  if (error) return <Alert tone="error">{error}</Alert>;

  const subscription = data?.subscription ?? null;

  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        action={
          isOwner ? (
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={() => void generateInvoice()}
              disabled={busy !== null}
            >
              {busy === "invoice" ? t("generating") : t("generate")}
            </button>
          ) : undefined
        }
      />
      {(actionError || actionSuccess) && (
        <div className="mb-5">
          <Alert tone={actionError ? "error" : "success"}>{actionError ?? actionSuccess}</Alert>
        </div>
      )}

      {subscription ? (
        <div className="card card-body mb-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                {t("current")}
              </p>
              <h2 className="mt-1 text-xl font-bold text-slate-900">
                {subscription.plan.name}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                {formatMoney(subscription.plan.monthlyPrice)} / {t("monthly")}
              </p>
            </div>
            <div className="flex items-center gap-6 text-sm">
              <div>
                <p className="text-xs text-slate-400">{t("status")}</p>
                <div className="mt-1">
                  <StatusBadge status={subscription.status} label={t(subscription.status)} />
                </div>
              </div>
              <div>
                <p className="text-xs text-slate-400">{t("periodEnd")}</p>
                <p className="mt-1 font-semibold text-slate-800">
                  {formatDate(subscription.currentPeriodEnd)}
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <Alert tone="error">Faol obuna topilmadi.</Alert>
      )}

      <div className="mb-5">
        <h2 className="mb-3 text-sm font-bold text-slate-800">{t("plans")}</h2>
        <div className="grid gap-4 lg:grid-cols-3">
          {plans.data?.items.map((plan) => {
            const current = subscription?.planId === plan.id;
            const features = plan.features[locale] ?? plan.features.uz ?? [];
            return (
              <div
                key={plan.id}
                className={`card card-body ${current ? "ring-2 ring-brand-500" : ""}`}
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-bold text-slate-900">{plan.name}</h3>
                  {current && (
                    <span className="badge bg-brand-50 text-brand-700">Joriy</span>
                  )}
                </div>
                <p className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
                  {formatMoney(plan.monthlyPrice)}
                  <span className="ml-1 text-xs font-medium text-slate-400">/ {t("monthly")}</span>
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {plan.maxUsers} {t("maxUsers")} · {plan.maxVehicles} {t("maxVehicles")}
                </p>
                <ul className="mt-4 space-y-1.5 text-sm text-slate-600">
                  {features.map((feature) => (
                    <li key={feature} className="flex gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                      {feature}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className={`mt-5 w-full ${current ? "btn-secondary" : "btn-primary"}`}
                  disabled={!isOwner || current || busy !== null}
                  onClick={() => void changePlan(plan.id)}
                >
                  {busy === plan.id
                    ? t("changing")
                    : current
                      ? "Joriy reja"
                      : t("change")}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-sm font-bold text-slate-800">{t("invoices")}</h2>
        </div>
        {!subscription || subscription.invoices.length === 0 ? (
          <EmptyState>{t("empty")}</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("number")}</th>
                  <th>{tc("period")}</th>
                  <th>{tc("amount")}</th>
                  <th>{t("dueDate")}</th>
                  <th>{tc("status")}</th>
                </tr>
              </thead>
              <tbody>
                {subscription.invoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td className="font-mono text-xs font-semibold text-slate-900">
                      {invoice.number}
                    </td>
                    <td>
                      {formatDate(invoice.periodStart)} — {formatDate(invoice.periodEnd)}
                    </td>
                    <td>{formatMoney(invoice.amount)}</td>
                    <td>{formatDate(invoice.dueDate)}</td>
                    <td>
                      <StatusBadge status={invoice.status} label={t(invoice.status)} />
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
