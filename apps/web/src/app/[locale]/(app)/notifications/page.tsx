"use client";

import { useMemo, useState } from "react";
import { formatDateTime, useApi } from "@/lib/use-api";
import { apiRequest } from "@/lib/client-api";
import { Alert, EmptyState, Loading, PageHeader } from "@/components/ui";

interface NotificationItem {
  id: string;
  event: string;
  jobId: string | null;
  recipients: number;
  sent: number;
  failed: number;
  status: "SENT" | "FAILED" | "SKIPPED" | "PARTIAL" | string;
  error: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

function formatEventName(event: string): { label: string; badge: string } {
  switch (event) {
    case "driver.payment_received":
      return { label: "Haydovchi to'lovi", badge: "bg-emerald-50 text-emerald-700 border-emerald-200" };
    case "driver.debt_reminder":
      return { label: "Qarzdorlik eslatmasi", badge: "bg-amber-50 text-amber-700 border-amber-200" };
    case "vehicle.license_expiring":
      return { label: "Litsenziya ogohlantirishi", badge: "bg-red-50 text-red-700 border-red-200" };
    case "payment.paid":
      return { label: "Shartnoma to'lovi", badge: "bg-blue-50 text-blue-700 border-blue-200" };
    case "payment.failed":
      return { label: "To'lov xatosi", badge: "bg-red-50 text-red-700 border-red-200" };
    case "subscription.invoice_issued":
      return { label: "Obuna hisobi", badge: "bg-purple-50 text-purple-700 border-purple-200" };
    case "subscription.trial_ending":
      return { label: "Sinov muddati", badge: "bg-orange-50 text-orange-700 border-orange-200" };
    case "system.test":
      return { label: "Test bildirishnoma", badge: "bg-slate-50 text-slate-700 border-slate-200" };
    default:
      return { label: event, badge: "bg-slate-50 text-slate-700 border-slate-200" };
  }
}

function statusBadge(status: string) {
  switch (status) {
    case "SENT":
      return <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 border border-emerald-200">Yetkazildi</span>;
    case "PARTIAL":
      return <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 border border-amber-200">Qisman</span>;
    case "FAILED":
      return <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 border border-red-200">Xatolik</span>;
    case "SKIPPED":
      return <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 border border-slate-200">O'tkazildi</span>;
    default:
      return <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{status}</span>;
  }
}

export default function NotificationsPage() {
  const { data, loading, error, reload } = useApi<{ items: NotificationItem[] }>("/notifications");
  const [filter, setFilter] = useState("all");
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  async function handleSendTest() {
    setActionLoading(true);
    setActionMessage(null);
    try {
      await apiRequest("/notifications/test", { method: "POST" });
      setActionMessage("Test bildirishnomasi navbatga qo'yildi va Telegram bot orqali yuborilmoqda.");
      setTimeout(() => void reload(), 1500);
    } catch (err) {
      setActionMessage(`Xatolik: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleRunReminders() {
    setActionLoading(true);
    setActionMessage(null);
    try {
      const res = await apiRequest<{
        tenants: number;
        debtRemindersEnqueued: number;
        licenseAlertsEnqueued: number;
      }>("/notifications/run-reminders", { method: "POST" });
      setActionMessage(
        `Eslatmalar tekshirildi: ${res.debtRemindersEnqueued} ta qarzdorlik eslatmasi va ${res.licenseAlertsEnqueued} ta litsenziya ogohlantirishi navbatga qo'yildi.`,
      );
      setTimeout(() => void reload(), 1500);
    } catch (err) {
      setActionMessage(`Xatolik: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setActionLoading(false);
    }
  }

  const [page, setPage] = useState(1);
  const pageSize = 25;

  const items = useMemo(() => data?.items ?? [], [data]);
  const filtered = useMemo(() => {
    return filter === "all" ? items : items.filter((i) => i.event === filter);
  }, [items, filter]);

  const totalPages = Math.ceil(filtered.length / pageSize) || 1;
  const pagedItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  const sentCount = items.filter((i) => i.status === "SENT").length;
  const failedCount = items.filter((i) => i.status === "FAILED").length;
  const skippedCount = items.filter((i) => i.status === "SKIPPED").length;

  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
        <PageHeader
          title="Bildirishnomalar"
          subtitle="Haydovchilarga to'lov kvitansiyalari, qarzdorlik eslatmalari va litsenziya ogohlantirishlari Telegram orqali yuboriladi."
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-secondary text-xs sm:text-sm"
            onClick={() => void handleSendTest()}
            disabled={actionLoading}
          >
            Test yuborish
          </button>
          <button
            type="button"
            className="btn-primary text-xs sm:text-sm"
            onClick={() => void handleRunReminders()}
            disabled={actionLoading}
          >
            Eslatmalarni hozir yuborish
          </button>
        </div>
      </div>

      {actionMessage && (
        <div className="mb-5">
          <Alert tone="success">{actionMessage}</Alert>
        </div>
      )}

      {error && (
        <div className="mb-5">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      {/* Statistika kartalari */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4 mb-6">
        <div className="card card-body">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Jami yuborilganlar</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{items.length}</p>
        </div>
        <div className="card card-body">
          <p className="text-xs font-medium text-emerald-600 uppercase tracking-wider">Yetkazildi</p>
          <p className="mt-1 text-2xl font-bold text-emerald-700">{sentCount}</p>
        </div>
        <div className="card card-body">
          <p className="text-xs font-medium text-amber-600 uppercase tracking-wider">O'tkazildi</p>
          <p className="mt-1 text-2xl font-bold text-amber-700">{skippedCount}</p>
        </div>
        <div className="card card-body">
          <p className="text-xs font-medium text-red-600 uppercase tracking-wider">Xatolik</p>
          <p className="mt-1 text-2xl font-bold text-red-700">{failedCount}</p>
        </div>
      </div>

      {/* Filtr tablari */}
      <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 pb-2 mb-4 text-xs font-medium">
        <button
          type="button"
          onClick={() => setFilter("all")}
          className={`rounded-lg px-3 py-1.5 transition ${filter === "all" ? "bg-brand-50 text-brand-800 font-semibold" : "text-slate-600 hover:bg-slate-100"}`}
        >
          Barchasi ({items.length})
        </button>
        <button
          type="button"
          onClick={() => setFilter("driver.payment_received")}
          className={`rounded-lg px-3 py-1.5 transition ${filter === "driver.payment_received" ? "bg-brand-50 text-brand-800 font-semibold" : "text-slate-600 hover:bg-slate-100"}`}
        >
          Haydovchi to'lovlari
        </button>
        <button
          type="button"
          onClick={() => setFilter("driver.debt_reminder")}
          className={`rounded-lg px-3 py-1.5 transition ${filter === "driver.debt_reminder" ? "bg-brand-50 text-brand-800 font-semibold" : "text-slate-600 hover:bg-slate-100"}`}
        >
          Qarzdorlik eslatmalari
        </button>
        <button
          type="button"
          onClick={() => setFilter("vehicle.license_expiring")}
          className={`rounded-lg px-3 py-1.5 transition ${filter === "vehicle.license_expiring" ? "bg-brand-50 text-brand-800 font-semibold" : "text-slate-600 hover:bg-slate-100"}`}
        >
          Litsenziya ogohlantirishlari
        </button>
      </div>

      {loading ? (
        <Loading />
      ) : filtered.length === 0 ? (
        <EmptyState>
          <p className="font-semibold text-slate-800">Bildirishnomalar topilmadi</p>
          <p className="mt-1">Hozircha hech qanday bildirishnoma qayd etilmagan.</p>
        </EmptyState>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Vaqt</th>
                  <th>Hodisa turi</th>
                  <th>Holat</th>
                  <th>Qabul qiluvchilar</th>
                  <th>Tafsilotlar</th>
                </tr>
              </thead>
              <tbody>
                {pagedItems.map((item) => {
                  const ev = formatEventName(item.event);
                  const p = (item.payload || {}) as Record<string, string | number | undefined>;
                  return (
                    <tr key={item.id}>
                      <td className="whitespace-nowrap text-xs text-slate-500">
                        {formatDateTime(item.createdAt)}
                      </td>
                      <td>
                        <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium border ${ev.badge}`}>
                          {ev.label}
                        </span>
                      </td>
                      <td>{statusBadge(item.status)}</td>
                      <td className="text-xs">
                        {item.status === "SKIPPED" ? (
                          <span className="text-slate-400">0</span>
                        ) : (
                          <span>
                            <strong className="text-emerald-700">{item.sent}</strong> / {item.recipients}
                          </span>
                        )}
                      </td>
                      <td className="text-xs text-slate-600 max-w-xs truncate">
                        {p.plateNumber && <span className="font-semibold text-slate-800 mr-2">{String(p.plateNumber)}</span>}
                        {p.amount && <span className="text-emerald-700 font-medium mr-2">{String(p.amount)} so'm</span>}
                        {p.driverName && <span className="text-slate-500 mr-2">({String(p.driverName)})</span>}
                        {p.daysLeft !== undefined && <span className="text-red-600 font-medium mr-2">{String(p.daysLeft)} kun qoldi</span>}
                        {item.error && <span className="text-red-500 block text-[11px] truncate">{item.error}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {totalPages > 1 && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-xs text-slate-600 bg-slate-50/50">
                <div>
                  Jami {filtered.length} ta bildirishnomadan {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, filtered.length)} ko&apos;rsatilmoqda
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                    className="btn-secondary px-2.5 py-1 text-xs disabled:opacity-40"
                  >
                    ← Oldingi
                  </button>
                  <span className="px-2 font-medium">
                    {page} / {totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                    className="btn-secondary px-2.5 py-1 text-xs disabled:opacity-40"
                  >
                    Keyingi →
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
