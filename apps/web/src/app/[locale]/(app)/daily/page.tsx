"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { apiRequest } from "@/lib/client-api";
import { formatDateTime, formatMoney, useApi } from "@/lib/use-api";
import { todayTashkent } from "@/lib/tashkent";
import type { DailyBoard } from "@/lib/types";
import { Alert, EmptyState, Loading, PageHeader, StatCard } from "@/components/ui";

export default function DailyPaymentsPage() {
  const t = useTranslations("daily");
  const tc = useTranslations("common");

  const [date, setDate] = useState(todayTashkent());
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const query = new URLSearchParams({ date });
  if (debounced) query.set("q", debounced);
  const board = useApi<DailyBoard>(`/billing/daily?${query.toString()}`);

  const [payingId, setPayingId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"CASH" | "CARD">("CASH");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionOk, setActionOk] = useState<string | null>(null);

  function openForm(vehicleId: string, remaining: string) {
    setPayingId(vehicleId);
    setAmount(Number(remaining) > 0 ? remaining : "");
    setMethod("CASH");
    setNote("");
    setActionError(null);
    setActionOk(null);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>, item: DailyBoard["items"][number]) {
    event.preventDefault();
    setSaving(true);
    setActionError(null);
    setActionOk(null);
    try {
      await apiRequest("/billing/payments", {
        method: "POST",
        body: {
          vehicleId: item.vehicleId,
          driverId: item.driver.id,
          amount,
          method,
          paidAt: date,
          ...(note.trim() ? { note: note.trim() } : {}),
        },
        headers: { "Idempotency-Key": crypto.randomUUID() },
      });
      setPayingId(null);
      setAmount("");
      setNote("");
      setActionOk(t("success"));
      await board.reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : tc("error"));
    } finally {
      setSaving(false);
    }
  }

  const data = board.data;

  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        action={
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="text-xs font-medium text-slate-500" htmlFor="daily-date">
              {t("date")}
            </label>
            <input
              id="daily-date"
              type="date"
              className="input w-full sm:w-44"
              value={date}
              onChange={(event) => setDate(event.target.value || todayTashkent())}
            />
            <input
              className="input w-full sm:w-72"
              placeholder={t("searchPlaceholder")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        }
      />

      {(actionError || actionOk) && (
        <div className="mb-4">
          <Alert tone={actionError ? "error" : "success"}>{actionError ?? actionOk}</Alert>
        </div>
      )}

      {board.loading ? (
        <Loading label={tc("loading")} />
      ) : board.error ? (
        <Alert tone="error">{board.error}</Alert>
      ) : !data ? null : (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <StatCard
              label={t("collectedToday")}
              value={formatMoney(data.summary.collectedToday)}
              hint={`${t("paymentsToday")}: ${data.summary.paymentsToday}`}
            />
            <StatCard label={t("expected")} value={formatMoney(data.summary.expected)} />
            <StatCard label={t("paidMonth")} value={formatMoney(data.summary.paidMonth)} />
            <StatCard label={t("debtMonth")} value={formatMoney(data.summary.debtMonth)} />
            <StatCard label={t("totalDebt")} value={formatMoney(data.summary.totalDebt)} />
          </div>

          {data.unassignedVehicles > 0 && (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
              {t("unassigned")}: <strong>{data.unassignedVehicles}</strong>. {t("unassignedHint")}
            </div>
          )}

          <div className="card mb-5">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <h2 className="text-sm font-bold text-slate-800">{t("title")}</h2>
              <span className="text-xs text-slate-400">
                {t("period")}: <span className="font-mono">{data.period}</span>
              </span>
            </div>
            {data.items.length === 0 ? (
              <EmptyState>{t("noDrivers")}</EmptyState>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t("plate")}</th>
                      <th>{t("driver")}</th>
                      <th>{t("plan")}</th>
                      <th>{t("paid")}</th>
                      <th>{t("debt")}</th>
                      <th>{t("paidToday")}</th>
                      <th>{t("action")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((item) => (
                      <tr key={item.vehicleId}>
                        <td>
                          <p className="font-mono text-sm font-semibold text-slate-900">
                            {item.plateNumber}
                          </p>
                          <p className="text-[11px] text-slate-400">{item.model}</p>
                        </td>
                        <td>
                          <p className="text-sm font-medium text-slate-800">{item.driver.fullName}</p>
                          <p className="font-mono text-[11px] text-slate-400">{item.driver.phone}</p>
                        </td>
                        <td>{formatMoney(item.month.due)}</td>
                        <td className="text-emerald-700">{formatMoney(item.month.paid)}</td>
                        <td
                          className={
                            Number(item.month.debt) > 0
                              ? "font-semibold text-red-600"
                              : "text-slate-500"
                          }
                        >
                          {formatMoney(item.month.debt)}
                        </td>
                        <td className="text-slate-600">{formatMoney(item.paidToday)}</td>
                        <td>
                          <div className="flex flex-col gap-1">
                            <button
                              type="button"
                              className="btn-primary text-xs"
                              onClick={() => openForm(item.vehicleId, item.month.debt)}
                            >
                              {t("pay")}
                            </button>
                            {Number(item.totalDebt) > 0 && (
                              <span className="text-[10px] text-slate-400">
                                {t("totalDebt")}: {formatMoney(item.totalDebt)}
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {data.items
                      .filter((item) => item.vehicleId === payingId)
                      .map((item) => (
                        <tr key={`pay-${item.vehicleId}`} className="bg-slate-50/70">
                          <td colSpan={7}>
                            <form
                              onSubmit={(event) => void onSubmit(event, item)}
                              className="space-y-3 px-1 py-2"
                            >
                              <p className="text-xs font-semibold text-slate-700">
                                {t("payTitle")} — {item.plateNumber} · {item.driver.fullName}
                              </p>
                              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                                <div>
                                  <label className="label" htmlFor={`amount-${item.vehicleId}`}>
                                    {t("amount")}
                                  </label>
                                  <input
                                    id={`amount-${item.vehicleId}`}
                                    className="input"
                                    inputMode="decimal"
                                    value={amount}
                                    onChange={(event) => setAmount(event.target.value)}
                                    required
                                  />
                                </div>
                                <div>
                                  <label className="label" htmlFor={`method-${item.vehicleId}`}>
                                    {t("method")}
                                  </label>
                                  <select
                                    id={`method-${item.vehicleId}`}
                                    className="select"
                                    value={method}
                                    onChange={(event) =>
                                      setMethod(event.target.value === "CARD" ? "CARD" : "CASH")
                                    }
                                  >
                                    <option value="CASH">{t("CASH")}</option>
                                    <option value="CARD">{t("CARD")}</option>
                                  </select>
                                </div>
                                <div className="lg:col-span-2">
                                  <label className="label" htmlFor={`note-${item.vehicleId}`}>
                                    {t("note")}
                                  </label>
                                  <input
                                    id={`note-${item.vehicleId}`}
                                    className="input"
                                    maxLength={300}
                                    value={note}
                                    onChange={(event) => setNote(event.target.value)}
                                  />
                                </div>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <button type="submit" className="btn-primary" disabled={saving}>
                                  {saving ? t("submitting") : t("submit")}
                                </button>
                                <button
                                  type="button"
                                  className="btn-secondary"
                                  onClick={() => setPayingId(null)}
                                >
                                  {tc("cancel")}
                                </button>
                                <span className="text-xs text-slate-500">
                                  {t("remaining")}: {formatMoney(item.month.debt)}
                                </span>
                              </div>
                            </form>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card">
            <div className="border-b border-slate-100 px-4 py-3">
              <h2 className="text-sm font-bold text-slate-800">{t("paymentsToday")}</h2>
            </div>
            {data.payments.length === 0 ? (
              <EmptyState>{t("noPayments")}</EmptyState>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{tc("date")}</th>
                      <th>{t("plate")}</th>
                      <th>{t("driver")}</th>
                      <th>{t("amount")}</th>
                      <th>{t("method")}</th>
                      <th>{t("note")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.payments.map((payment) => (
                      <tr key={payment.id}>
                        <td className="text-xs text-slate-600">{formatDateTime(payment.paidAt)}</td>
                        <td className="font-mono text-xs font-semibold">
                          {payment.vehicle.plateNumber}
                        </td>
                        <td>
                          <p className="text-sm">{payment.driver.fullName}</p>
                          <p className="font-mono text-[11px] text-slate-400">
                            {payment.driver.phone}
                          </p>
                        </td>
                        <td className="font-semibold text-slate-900">
                          {formatMoney(payment.amount)}
                        </td>
                        <td>
                          <span className="badge bg-slate-100 text-slate-600">
                            {payment.method === "CASH" ? t("CASH") : t("CARD")}
                          </span>
                        </td>
                        <td className="text-xs text-slate-500">
                          {payment.note ?? (payment.receivedBy ? payment.receivedBy.fullName : "—")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
