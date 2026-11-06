"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { apiRequest } from "@/lib/client-api";
import { formatDate, formatMoney, useApi } from "@/lib/use-api";
import type { AuthUser, Plan, Subscription, SubscriptionInvoice } from "@/lib/types";
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
  const [selectedInvoice, setSelectedInvoice] = useState<SubscriptionInvoice | null>(null);

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
      setActionSuccess("Obuna rejasi muvaffaqiyatli yangilandi.");
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
  const contract = Boolean(subscription?.monthlyFee);
  const monthlyFee = subscription?.monthlyFee ?? subscription?.plan?.monthlyPrice ?? "0";

  const isTrial =
    subscription?.status === "TRIAL" &&
    subscription.currentPeriodEnd &&
    new Date(subscription.currentPeriodEnd) > new Date();

  const isPastDue =
    subscription?.status === "PAST_DUE" ||
    (subscription?.invoices ?? []).some((invoice) => invoice.status === "OVERDUE");

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
              disabled={busy !== null || Boolean(isTrial)}
              title={isTrial ? t("trialButtonDisabled") : undefined}
            >
              {busy === "invoice"
                ? t("generating")
                : isTrial
                  ? t("trialButtonDisabled")
                  : t("generate")}
            </button>
          ) : undefined
        }
      />

      {isTrial && subscription?.currentPeriodEnd && (
        <div className="mb-5 rounded-2xl border border-sky-200 bg-sky-50/70 p-4 text-sky-900 shadow-sm">
          <div className="flex items-start gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-sky-500 text-xs font-bold text-white">
              ✓
            </span>
            <div>
              <p className="text-sm font-semibold">
                {t("trialNotice", { date: formatDate(subscription.currentPeriodEnd) })}
              </p>
              <p className="mt-0.5 text-xs text-sky-700">{t("trialButtonDisabled")}</p>
            </div>
          </div>
        </div>
      )}

      {isPastDue && (
        <div className="mb-5">
          <Alert tone="error">{t("overdueNotice")}</Alert>
        </div>
      )}

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
                {formatMoney(monthlyFee)} / {t("monthly")}
              </p>
              {contract && (
                <span className="badge mt-2 bg-amber-100 text-amber-800">{t("contract")}</span>
              )}
            </div>
            <div className="flex items-center gap-6 text-sm">
              <div>
                <p className="text-xs text-slate-400">{t("status")}</p>
                <div className="mt-1">
                  <StatusBadge status={subscription.status} label={t(subscription.status)} />
                </div>
              </div>
              <div>
                <p className="text-xs text-slate-400">{contract ? t("paidUntil") : t("periodEnd")}</p>
                <p className="mt-1 font-semibold text-slate-800">
                  {formatDate(subscription.currentPeriodEnd)}
                </p>
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
            <span>
              <b>{subscription.plan.maxUsers}</b> {t("maxUsers")}
            </span>
            <span>•</span>
            <span>
              <b>{subscription.plan.maxVehicles}</b> {t("maxVehicles")}
            </span>
          </div>

          {contract && <p className="mt-3 text-sm text-slate-600">{t("contractHint")}</p>}
        </div>
      ) : (
        <Alert tone="error">Faol obuna topilmadi.</Alert>
      )}

      {!contract && (
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
      )}

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
                  <th className="text-right">{tc("actions")}</th>
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
                    <td className="text-right">
                      <button
                        type="button"
                        className="btn-ghost text-xs text-brand-600 hover:text-brand-700"
                        onClick={() => setSelectedInvoice(invoice)}
                      >
                        {t("viewInvoice")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm print:p-0 print:bg-transparent">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl print:shadow-none print:w-full print:max-w-none">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4 print:border-none">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Uyushma SaaS Platform
                </span>
                <h3 className="text-lg font-bold text-slate-900">{t("invoiceDetails")}</h3>
              </div>
              <button
                type="button"
                className="btn-ghost text-xs print:hidden"
                onClick={() => setSelectedInvoice(null)}
              >
                ✕
              </button>
            </div>

            <div className="my-5 space-y-3.5 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">{t("number")}</span>
                <span className="font-mono font-bold text-slate-900">{selectedInvoice.number}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">{tc("status")}</span>
                <StatusBadge status={selectedInvoice.status} label={t(selectedInvoice.status)} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">{tc("period")}</span>
                <span className="font-medium text-slate-800">
                  {formatDate(selectedInvoice.periodStart)} — {formatDate(selectedInvoice.periodEnd)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">{t("dueDate")}</span>
                <span className="font-medium text-slate-800">{formatDate(selectedInvoice.dueDate)}</span>
              </div>
              {selectedInvoice.paidAt && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">{t("paidAt")}</span>
                  <span className="font-medium text-emerald-600">{formatDate(selectedInvoice.paidAt)}</span>
                </div>
              )}
              <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 p-4">
                <span className="text-sm font-semibold text-slate-700">{tc("amount")}</span>
                <span className="text-xl font-bold text-brand-600">
                  {formatMoney(selectedInvoice.amount)}
                </span>
              </div>
              <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-900">
                <p className="font-semibold">{t("paymentNotice")}</p>
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-100 pt-4 print:hidden">
              <button
                type="button"
                className="btn-secondary text-xs"
                onClick={() => window.print()}
              >
                🖨 {t("print")}
              </button>
              <button
                type="button"
                className="btn-primary text-xs"
                onClick={() => setSelectedInvoice(null)}
              >
                {tc("close")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
