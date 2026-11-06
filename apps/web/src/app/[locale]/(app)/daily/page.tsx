"use client";

import { Fragment, useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { apiRequest } from "@/lib/client-api";
import { formatDate, formatDateTime, formatMoney, useApi } from "@/lib/use-api";
import { todayTashkent } from "@/lib/tashkent";
import type { DailyBoard } from "@/lib/types";
import { Alert, EmptyState, Loading, PageHeader, StatCard } from "@/components/ui";
import { exportToExcelTable } from "@/lib/export-excel";
import { formatUzPlate } from "@/lib/plate";
import { formatUzPhone } from "@/lib/phone";

interface DriverShiftRow {
  id: string;
  driverId: string;
  driverName: string;
  driverPhone: string;
  vehicleId: string;
  plateNumber: string;
  model: string;
  routeName: string | null;
  startedAt: string;
  endedAt: string | null;
  startOdometer: number | null;
  endOdometer: number | null;
  distanceKm: number | null;
  status: "ACTIVE" | "COMPLETED";
  note: string | null;
}

interface DriverIncidentRow {
  id: string;
  driverId: string;
  driverName: string;
  driverPhone: string;
  vehicleId: string;
  plateNumber: string;
  model: string;
  routeName: string | null;
  kind: string;
  description: string | null;
  status: "OPEN" | "RESOLVED";
  reportedAt: string;
  resolvedAt?: string | null;
}

export default function DailyPaymentsPage() {
  const t = useTranslations("daily");
  const tc = useTranslations("common");

  const [viewTab, setViewTab] = useState<"payments" | "shifts">("payments");
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

  const shiftsApi = useApi<DriverShiftRow[]>(`/drivers/shifts/all?date=${date}`);
  const incidentsApi = useApi<DriverIncidentRow[]>("/drivers/incidents/all?status=OPEN");

  const [payingId, setPayingId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"CASH" | "CARD">("CASH");
  const [days, setDays] = useState("1");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const [remindingId, setRemindingId] = useState<string | null>(null);
  const [bulkReminding, setBulkReminding] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionOk, setActionOk] = useState<string | null>(null);

  function openForm(vehicleId: string, remaining: string) {
    setPayingId(vehicleId);
    setAmount(Number(remaining) > 0 ? remaining : "");
    setMethod("CASH");
    setDays("1");
    setNote("");
    setActionError(null);
    setActionOk(null);
  }

  useEffect(() => {
    if (!payingId) return;
    document
      .getElementById(`pay-form-${payingId}`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [payingId]);

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
          days: Math.min(31, Math.max(1, Number(days) || 1)),
          paidAt: date,
          ...(note.trim() ? { note: note.trim() } : {}),
        },
        headers: { "Idempotency-Key": crypto.randomUUID() },
      });
      setPayingId(null);
      setAmount("");
      setDays("1");
      setNote("");
      setActionOk(t("success"));
      await board.reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : tc("error"));
    } finally {
      setSaving(false);
    }
  }

  async function onSendReminder(driverId: string) {
    setRemindingId(driverId);
    setActionError(null);
    setActionOk(null);
    try {
      const res = await apiRequest<{ message: string }>(`/billing/remind/${driverId}`, {
        method: "POST",
      });
      setActionOk(res.message);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Eslatma yuborishda xatolik yuz berdi");
    } finally {
      setRemindingId(null);
    }
  }

  async function onSendBulkReminders() {
    if (!confirm("Barcha qarzdor haydovchilarga Telegram orqali eslatma yuborilsinmi?")) return;
    setBulkReminding(true);
    setActionError(null);
    setActionOk(null);
    try {
      const res = await apiRequest<{ message: string }>("/billing/remind-all", {
        method: "POST",
      });
      setActionOk(res.message);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Ommaviy eslatma yuborishda xatolik yuz berdi");
    } finally {
      setBulkReminding(false);
    }
  }

  async function onResolveIncident(incidentId: string) {
    try {
      await apiRequest(`/drivers/incidents/${incidentId}/resolve`, { method: "PATCH" });
      await incidentsApi.reload();
      setActionOk("Nosozlik xabari hal qilindi deb belgilandi");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Xatolik yuz berdi");
    }
  }

  function handleExportExcel() {
    if (!data) return;
    const headers = [
      "Davlat raqami",
      "Model",
      "Haydovchi F.I.Sh",
      "Telefon",
      "Oylik plan (so'm)",
      "Shu oy to'langan (so'm)",
      "Shu oy qarzi (so'm)",
      "Bugun to'langan (so'm)",
      "Umumiy qarz (so'm)",
      "Ishga chiqqan",
      "To'langan kunlar",
      "Qoplangan davr",
    ];
    const rows = data.items.map((item) => [
      item.plateNumber,
      item.model,
      item.driver?.fullName ?? "—",
      item.driver?.phone ?? "—",
      item.month.due,
      item.month.paid,
      item.month.debt,
      item.paidToday,
      item.totalDebt,
      item.worked ? "Ha" : "Yo'q",
      item.paidDays,
      item.coveredFrom && item.coveredUntil
        ? `${item.coveredFrom} — ${item.coveredUntil}`
        : "—",
    ]);
    exportToExcelTable(`Kunlik_tolovlar_${date}`, "Kunlik to'lovlar", headers, rows);
  }

  const data = board.data;
  const shifts = shiftsApi.data ?? [];
  const incidents = incidentsApi.data ?? [];
  const activeShiftsCount = shifts.filter((s) => s.status === "ACTIVE").length;
  const completedShiftsCount = shifts.filter((s) => s.status === "COMPLETED").length;
  const totalKmToday = shifts.reduce((acc, s) => acc + (s.distanceKm ?? 0), 0);

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
            <button
              type="button"
              onClick={handleExportExcel}
              className="btn-secondary flex items-center justify-center gap-1.5 text-xs text-emerald-700 hover:border-emerald-300 hover:bg-emerald-50"
              title="Excel formatida yuklab olish"
            >
              <span>📊</span>
              <span>{t("exportExcel")}</span>
            </button>
          </div>
        }
      />

      {/* SOS Alert Banner agar faol favqulodda xabarlar bo'lsa */}
      {incidents.length > 0 && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 shadow-sm animate-pulse">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xl">🚨</span>
              <div>
                <h3 className="text-sm font-bold text-red-900">{t("incidentsTitle")} ({incidents.length} ta)</h3>
                <p className="text-xs text-red-700">Haydovchilar tomonidan yo'ldan texnik nosozlik yoki favqulodda xabar yuborilgan.</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setViewTab("shifts")}
              className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
            >
              Ko'rish
            </button>
          </div>
        </div>
      )}

      {/* Tabs navigation */}
      <div className="mb-5 flex items-center gap-2 border-b border-slate-200">
        <button
          type="button"
          onClick={() => setViewTab("payments")}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition ${
            viewTab === "payments"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          <span>💰</span>
          <span>{t("title")}</span>
        </button>

        <button
          type="button"
          onClick={() => setViewTab("shifts")}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition ${
            viewTab === "shifts"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          <span>🚦</span>
          <span>{t("shiftsMonitor")}</span>
          {activeShiftsCount > 0 && (
            <span className="inline-flex items-center justify-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800">
              {activeShiftsCount}
            </span>
          )}
        </button>
      </div>

      {(actionError || actionOk) && (
        <div className="mb-4">
          <Alert tone={actionError ? "error" : "success"}>{actionError ?? actionOk}</Alert>
        </div>
      )}

      {viewTab === "payments" ? (
        <>
          {board.loading ? (
            <Loading label={tc("loading")} />
          ) : board.error ? (
            <Alert tone="error">{board.error}</Alert>
          ) : !data ? null : (
            <>
              <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
                <StatCard
                  label={t("collectedToday")}
                  value={formatMoney(data.summary.collectedToday)}
                  hint={`${t("paymentsToday")}: ${data.summary.paymentsToday}`}
                />
                <StatCard
                  label={t("workedToday")}
                  value={`${data.summary.workedToday} / ${data.summary.withDriver}`}
                  hint={t("workedHint")}
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
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-bold text-slate-800">{t("title")}</h2>
                    <span className="text-xs text-slate-400">
                      {t("period")}: <span className="font-mono">{data.period}</span>
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={onSendBulkReminders}
                    disabled={bulkReminding}
                    className="btn-secondary flex items-center gap-1.5 text-xs text-indigo-700 hover:border-indigo-300 hover:bg-indigo-50"
                  >
                    <span>✈️</span>
                    <span>{bulkReminding ? t("sendingReminder") : t("sendBulkReminder")}</span>
                  </button>
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
                          <th>{t("workedStatus")}</th>
                          <th>{t("plan")}</th>
                          <th>{t("paid")}</th>
                          <th>{t("debt")}</th>
                          <th>{t("paidToday")}</th>
                          <th>{t("action")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.items.map((item) => {
                          const hasDebt = Number(item.month.debt) > 0 || Number(item.totalDebt) > 0;
                          return (
                            <Fragment key={item.vehicleId}>
                            <tr>
                              <td>
                                <p className="font-mono text-sm font-semibold text-slate-900">
                                  {formatUzPlate(item.plateNumber)}
                                </p>
                                <p className="text-[11px] text-slate-400">{item.model}</p>
                              </td>
                              <td>
                                <p className="text-sm font-medium text-slate-800">{item.driver.fullName}</p>
                                <p className="font-mono text-[11px] text-slate-400">
                                  {formatUzPhone(item.driver.phone)}
                                </p>
                              </td>
                              <td>
                                {item.worked ? (
                                  <div className="space-y-0.5">
                                    <span className="badge bg-emerald-50 text-emerald-700">
                                      ✅ {t("workedYes")}
                                    </span>
                                    <p className="text-[10px] text-slate-500">
                                      {t("daysCount", { count: item.paidDays })}
                                      {item.coveredUntil
                                        ? ` · ${t("coverageUntil", { date: formatDate(item.coveredUntil) })}`
                                        : ""}
                                    </p>
                                  </div>
                                ) : (
                                  <span className="badge bg-rose-50 text-rose-700">
                                    {t("workedNo")}
                                  </span>
                                )}
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
                                <div className="flex flex-col gap-1.5">
                                  <div className="flex items-center gap-1">
                                    <button
                                      type="button"
                                      className="btn-primary text-xs"
                                      onClick={() => openForm(item.vehicleId, item.month.debt)}
                                    >
                                      {t("pay")}
                                    </button>
                                    {hasDebt && item.driver?.id && (
                                      <button
                                        type="button"
                                        onClick={() => onSendReminder(item.driver.id)}
                                        disabled={remindingId === item.driver.id}
                                        title="Haydovchiga Telegram bot orqali qarzdorlikni eslatish"
                                        className="rounded-lg border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
                                      >
                                        {remindingId === item.driver.id ? "..." : "✈️ Eslatma"}
                                      </button>
                                    )}
                                  </div>
                                  {Number(item.totalDebt) > 0 && (
                                    <span className="text-[10px] text-slate-400">
                                      {t("totalDebt")}: {formatMoney(item.totalDebt)}
                                    </span>
                                  )}
                                </div>
                              </td>
                            </tr>
                            {item.vehicleId === payingId && (
                            <tr id={`pay-form-${item.vehicleId}`} className="bg-slate-50/70">
                              <td colSpan={8}>
                                <form
                                  onSubmit={(event) => void onSubmit(event, item)}
                                  className="space-y-3 px-1 py-2"
                                >
                                  <p className="text-xs font-semibold text-slate-700">
                                    {t("payTitle")} — {item.plateNumber} · {item.driver.fullName}
                                  </p>
                                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
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
                                    <div>
                                      <label className="label" htmlFor={`days-${item.vehicleId}`}>
                                        {t("days")}
                                      </label>
                                      <input
                                        id={`days-${item.vehicleId}`}
                                        className="input"
                                        type="number"
                                        min={1}
                                        max={31}
                                        value={days}
                                        onChange={(event) => setDays(event.target.value)}
                                        required
                                      />
                                      <p className="mt-1 text-[11px] text-slate-400">
                                        {t("daysHint")}
                                      </p>
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
                            )}
                            </Fragment>
                          );
                        })}
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
                          <th>{t("coverage")}</th>
                          <th>{t("note")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.payments.map((payment) => (
                          <tr key={payment.id}>
                            <td className="text-xs text-slate-600">{formatDateTime(payment.paidAt)}</td>
                            <td className="font-mono text-xs font-semibold">
                              {formatUzPlate(payment.vehicle.plateNumber)}
                            </td>
                            <td>
                              <p className="text-sm">{payment.driver.fullName}</p>
                              <p className="font-mono text-[11px] text-slate-400">
                                {formatUzPhone(payment.driver.phone)}
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
                            <td className="text-xs text-slate-600">
                              <p className="font-semibold">
                                {t("daysCount", { count: payment.days })}
                              </p>
                              <p className="text-[10px] text-slate-400">
                                {formatDate(payment.coveredFrom)} — {formatDate(payment.coveredUntil)}
                              </p>
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
      ) : (
        /* Smenalar va Yo'nalish Monitori */
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Yo'nalishda faol (Yo'lda)"
              value={activeShiftsCount}
              hint="Hozir harakatdagi avtomobillar"
            />
            <StatCard
              label="Bugun yakunlangan"
              value={completedShiftsCount}
              hint="Smenani yakunlaganlar"
            />
            <StatCard
              label="Jami bosib o'tilgan masofa"
              value={`${totalKmToday.toLocaleString("uz-UZ")} km`}
              hint="Bugungi probeg hisoboti"
            />
            <StatCard
              label="Favqulodda xabarlar (SOS)"
              value={incidents.length}
              hint="E'tibor talab holatlar"
            />
          </div>

          {/* Favqulodda xabarlar jadvali */}
          {incidents.length > 0 && (
            <div className="card mb-5 border-red-200">
              <div className="border-b border-red-100 bg-red-50/50 px-4 py-3">
                <h3 className="text-sm font-bold text-red-900">🚨 {t("incidentsTitle")}</h3>
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Vaqt</th>
                      <th>Avtomobil</th>
                      <th>Haydovchi</th>
                      <th>Nosozlik turi</th>
                      <th>Izoh</th>
                      <th>Amal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {incidents.map((inc) => (
                      <tr key={inc.id} className="bg-red-50/30">
                        <td className="text-xs font-mono">{formatDateTime(inc.reportedAt)}</td>
                        <td>
                          <span className="font-mono font-bold text-slate-900">{formatUzPlate(inc.plateNumber)}</span>
                          <span className="text-[11px] text-slate-400 block">{inc.model}</span>
                        </td>
                        <td>
                          <span className="font-medium text-slate-800">{inc.driverName}</span>
                          <span className="text-[11px] text-slate-400 block font-mono">{inc.driverPhone}</span>
                        </td>
                        <td>
                          <span className="badge bg-red-100 font-semibold text-red-800">
                            {inc.kind}
                          </span>
                        </td>
                        <td className="text-xs text-slate-600">{inc.description ?? "—"}</td>
                        <td>
                          <button
                            type="button"
                            onClick={() => onResolveIncident(inc.id)}
                            className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700"
                          >
                            {t("resolveIncident")}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Smenalar jadvali */}
          <div className="card">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <h2 className="text-sm font-bold text-slate-800">{t("activeShifts")}</h2>
              <span className="text-xs text-slate-500">Sana: <span className="font-mono">{date}</span></span>
            </div>
            {shifts.length === 0 ? (
              <EmptyState>{t("noShifts")}</EmptyState>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Holat</th>
                      <th>Avtomobil</th>
                      <th>Haydovchi</th>
                      <th>Yo'nalish</th>
                      <th>{t("departureTime")}</th>
                      <th>{t("startOdometer")}</th>
                      <th>{t("endOdometer")}</th>
                      <th>{t("distance")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shifts.map((shift) => {
                      const isActive = shift.status === "ACTIVE";
                      return (
                        <tr key={shift.id}>
                          <td>
                            {isActive ? (
                              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                                {t("onShift")}
                              </span>
                            ) : (
                              <span className="badge bg-slate-100 text-slate-600">
                                {t("completedShift")}
                              </span>
                            )}
                          </td>
                          <td>
                            <p className="font-mono text-sm font-semibold text-slate-900">{formatUzPlate(shift.plateNumber)}</p>
                            <p className="text-[11px] text-slate-400">{shift.model}</p>
                          </td>
                          <td>
                            <p className="text-sm font-medium text-slate-800">{shift.driverName}</p>
                            <p className="font-mono text-[11px] text-slate-400">{shift.driverPhone}</p>
                          </td>
                          <td className="text-xs text-slate-700">
                            {shift.routeName ? <span className="badge bg-blue-50 text-blue-700">{shift.routeName}</span> : "—"}
                          </td>
                          <td className="font-mono text-xs text-slate-600">{formatDateTime(shift.startedAt)}</td>
                          <td className="font-mono text-xs text-slate-600">
                            {shift.startOdometer ? `${shift.startOdometer.toLocaleString("uz-UZ")} km` : "—"}
                          </td>
                          <td className="font-mono text-xs text-slate-600">
                            {shift.endOdometer ? `${shift.endOdometer.toLocaleString("uz-UZ")} km` : "—"}
                          </td>
                          <td className="font-mono text-xs font-bold text-slate-800">
                            {shift.distanceKm !== null ? `${shift.distanceKm.toLocaleString("uz-UZ")} km` : "—"}
                          </td>
                        </tr>
                      );
                    })}
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
