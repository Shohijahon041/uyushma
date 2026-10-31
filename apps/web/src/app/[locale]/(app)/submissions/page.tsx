"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { apiRequest } from "@/lib/client-api";
import { formatDateTime, formatMoney, useApi } from "@/lib/use-api";
import type { PaymentSubmission, FraudRiskLevel, SubmissionStatus } from "@/lib/types";
import { Alert, EmptyState, Loading, PageHeader, StatCard, StatusBadge } from "@/components/ui";

interface SubmissionsResponse {
  items: PaymentSubmission[];
  total: number;
  page: number;
  pageSize: number;
}

export default function SubmissionsPage() {
  const t = useTranslations("submissions");
  const tc = useTranslations("common");

  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [riskFilter, setRiskFilter] = useState<string>("ALL");

  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    if (statusFilter !== "ALL") params.set("status", statusFilter);
    if (riskFilter !== "ALL") params.set("risk", riskFilter);
    const qs = params.toString();
    return qs ? `?${qs}` : "";
  }, [statusFilter, riskFilter]);

  const { data, loading, error, reload } = useApi<SubmissionsResponse>(
    `/submissions${queryParams}`,
  );

  // Modals state
  const [inspectItem, setInspectItem] = useState<PaymentSubmission | null>(null);
  const [approveItem, setApproveItem] = useState<PaymentSubmission | null>(null);
  const [approveNote, setApproveNote] = useState("");
  const [rejectItem, setRejectItem] = useState<PaymentSubmission | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Statistics calculation
  const stats = useMemo(() => {
    const items = data?.items ?? [];
    const pending = items.filter((i) => i.status === "PENDING").length;
    const highRisk = items.filter((i) => i.fraudRisk === "HIGH").length;
    const approved = items.filter((i) => i.status === "APPROVED").length;
    return { total: data?.total ?? 0, pending, highRisk, approved };
  }, [data]);

  async function handleApprove() {
    if (!approveItem) return;
    setModalError(null);
    setActionError(null);
    setActionSuccess(null);
    setBusy(true);
    try {
      await apiRequest(`/submissions/${approveItem.id}/approve`, {
        method: "POST",
        body: { note: approveNote.trim() || undefined },
      });
      setActionSuccess(`To'lov cheki tasdiqlandi (#${approveItem.id.slice(0, 8)})`);
      setApproveItem(null);
      setApproveNote("");
      if (inspectItem?.id === approveItem.id) setInspectItem(null);
      await reload();
    } catch (err) {
      const msg = err instanceof Error ? err.message : tc("error");
      setModalError(msg);
      setActionError(msg);
    } finally {
      setBusy(false);
    }
  }

  async function handleReject() {
    if (!rejectItem) return;
    if (!rejectReason.trim()) {
      setModalError("Iltimos, rad etish sababini yozing.");
      return;
    }
    setModalError(null);
    setActionError(null);
    setActionSuccess(null);
    setBusy(true);
    try {
      await apiRequest(`/submissions/${rejectItem.id}/reject`, {
        method: "POST",
        body: { reason: rejectReason.trim() },
      });
      setActionSuccess(`Ariza rad etildi va haydovchiga bot orqali xabar yetkazildi.`);
      setRejectItem(null);
      setRejectReason("");
      if (inspectItem?.id === rejectItem.id) setInspectItem(null);
      await reload();
    } catch (err) {
      const msg = err instanceof Error ? err.message : tc("error");
      setModalError(msg);
      setActionError(msg);
    } finally {
      setBusy(false);
    }
  }

  function getRiskBadge(risk: FraudRiskLevel, score: number) {
    if (risk === "HIGH") {
      return (
        <span className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700 ring-1 ring-inset ring-rose-600/20">
          <span>🛑</span>
          <span>{t("riskHigh")} ({score}/100)</span>
        </span>
      );
    }
    if (risk === "MEDIUM") {
      return (
        <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700 ring-1 ring-inset ring-amber-600/20">
          <span>⚠️</span>
          <span>{t("riskMedium")} ({score}/100)</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
        <span>✅</span>
        <span>{t("riskLow")} ({score}/100)</span>
      </span>
    );
  }

  function getStatusBadge(status: SubmissionStatus) {
    if (status === "APPROVED") {
      return <StatusBadge status="APPROVED" label={t("approved")} />;
    }
    if (status === "REJECTED") {
      return <StatusBadge status="REJECTED" label={t("rejected")} />;
    }
    return <StatusBadge status="PENDING" label={t("pending")} />;
  }

  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        action={
          <div className="flex items-center gap-2">
            <Link
              href="/settings"
              className="btn-secondary text-xs"
            >
              💳 Karta sozlamalari
            </Link>
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={() => void reload()}
              disabled={loading}
            >
              {loading ? tc("loading") : tc("refresh")}
            </button>
          </div>
        }
      />

      {actionSuccess && (
        <div className="mb-4">
          <Alert tone="success">{actionSuccess}</Alert>
        </div>
      )}

      {actionError && (
        <div className="mb-4">
          <Alert tone="error">{actionError}</Alert>
        </div>
      )}

      {/* Statistika kartochkalari */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Jami arizalar"
          value={stats.total}
          hint="Barcha topshirilgan cheklar"
          tone="blue"
        />
        <StatCard
          label="Kutilayotgan"
          value={stats.pending}
          hint="Admin tasdiqlashi kerak"
          tone="amber"
        />
        <StatCard
          label="AI Soxtalik xavfi"
          value={stats.highRisk}
          hint="Tahrirlangan yoki shubhali cheklar"
          tone="red"
        />
        <StatCard
          label="Tasdiqlangan"
          value={stats.approved}
          hint="Mablag' hisobga tushirilgan"
          tone="emerald"
        />
      </div>

      {/* Filtrlar */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-500">Holat:</span>
          {(["ALL", "PENDING", "APPROVED", "REJECTED"] as const).map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={`rounded-xl px-3 py-1.5 text-xs font-medium transition-colors ${
                statusFilter === st
                  ? "bg-brand-600 text-white shadow-xs"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {st === "ALL"
                ? t("all")
                : st === "PENDING"
                  ? t("pending")
                  : st === "APPROVED"
                    ? t("approved")
                    : t("rejected")}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-500">AI Xavf:</span>
          <select
            className="select select-sm text-xs"
            value={riskFilter}
            onChange={(e) => setRiskFilter(e.target.value)}
          >
            <option value="ALL">Barchasi</option>
            <option value="LOW">Faqat past xavf (Toza)</option>
            <option value="MEDIUM">O&apos;rta xavf</option>
            <option value="HIGH">Yuqori xavf (Soxta bo&apos;lishi mumkin)</option>
          </select>
        </div>
      </div>

      {/* Arizalar ro'yxati jadvali */}
      {loading && !data ? (
        <Loading label={tc("loading")} />
      ) : error ? (
        <Alert tone="error">{error}</Alert>
      ) : data?.items.length === 0 ? (
        <div className="card card-body">
          <EmptyState>{t("empty")}</EmptyState>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("driver")}</th>
                  <th>{t("vehicle")}</th>
                  <th>{t("amount")}</th>
                  <th>{t("fraudRisk")}</th>
                  <th>{t("receipt")}</th>
                  <th>{t("date")}</th>
                  <th>{tc("status")}</th>
                  <th className="text-right">{tc("actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data?.items.map((sub) => {
                  const receiptUrl = (sub as any).receiptFileUrl ?? sub.receiptUrl;
                  return (
                    <tr key={sub.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="font-medium text-slate-900">
                        <div>{sub.driver.fullName}</div>
                        <div className="font-mono text-xs text-slate-400">
                          {sub.driver.phone}
                        </div>
                      </td>
                      <td className="text-sm">
                        {sub.vehicle ? (
                          <>
                            <div className="font-semibold text-slate-800">
                              {sub.vehicle.plateNumber}
                            </div>
                            <div className="text-xs text-slate-400">
                              {sub.vehicle.model}
                            </div>
                          </>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap font-bold text-slate-900">
                        {formatMoney(sub.amount)} {tc("sum")}
                      </td>
                      <td>
                        <div className="space-y-1">
                          {getRiskBadge(sub.fraudRisk, sub.fraudScore)}
                          {sub.fraudFlags && sub.fraudFlags.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {sub.fraudFlags.slice(0, 2).map((fl, idx) => (
                                <span
                                  key={idx}
                                  className="inline-block rounded bg-rose-50 px-1.5 py-0.5 text-[10px] text-rose-600"
                                >
                                  {fl}
                                </span>
                              ))}
                              {sub.fraudFlags.length > 2 && (
                                <span className="text-[10px] text-slate-400">
                                  +{sub.fraudFlags.length - 2}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                      <td>
                        {receiptUrl ? (
                          <button
                            type="button"
                            onClick={() => setInspectItem(sub)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 shadow-2xs hover:bg-slate-50"
                          >
                            <span>🖼️</span>
                            <span>{t("viewReceipt")}</span>
                          </button>
                        ) : (
                          <span className="text-xs text-slate-400">Rasm yo&apos;q</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap text-xs text-slate-500">
                        {formatDateTime(sub.createdAt)}
                      </td>
                      <td>{getStatusBadge(sub.status)}</td>
                      <td className="text-right">
                        {sub.status === "PENDING" ? (
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              className="btn-secondary px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 hover:border-emerald-200"
                              onClick={() => {
                                setApproveItem(sub);
                                setApproveNote("");
                              }}
                            >
                              Tasdiqlash
                            </button>
                            <button
                              type="button"
                              className="btn-secondary px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50 hover:border-rose-200"
                              onClick={() => {
                                setRejectItem(sub);
                                setRejectReason("");
                              }}
                            >
                              Rad etish
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="btn-secondary px-2 py-1 text-xs"
                            onClick={() => setInspectItem(sub)}
                          >
                            Tafsilotlar
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 1. Chek va AI tahlilini to'liq ko'rish modali */}
      {inspectItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
          <div className="relative max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  To&apos;lov cheki tahlili #{inspectItem.id.slice(0, 8)}
                </h3>
                <p className="text-xs text-slate-500">
                  Haydovchi: {inspectItem.driver.fullName} · Summa:{" "}
                  <b>{formatMoney(inspectItem.amount)} {tc("sum")}</b>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInspectItem(null)}
                className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                ✕
              </button>
            </div>

            <div className="mt-6 grid gap-6 md:grid-cols-2">
              {/* Rasm ko'rinishi */}
              <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-slate-950/5 p-3">
                {((inspectItem as any).receiptFileUrl ?? inspectItem.receiptUrl) ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={(inspectItem as any).receiptFileUrl ?? inspectItem.receiptUrl}
                    alt="To'lov cheki"
                    className="max-h-[500px] w-auto rounded-xl object-contain shadow-sm"
                  />
                ) : (
                  <div className="p-8 text-sm text-slate-400">Rasm yuklanmagan</div>
                )}
                <div className="mt-3 flex w-full justify-between text-xs text-slate-500">
                  <span>Yuborilgan: {formatDateTime(inspectItem.createdAt)}</span>
                  {((inspectItem as any).receiptFileUrl ?? inspectItem.receiptUrl) && (
                    <a
                      href={(inspectItem as any).receiptFileUrl ?? inspectItem.receiptUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-brand-600 hover:underline"
                    >
                      Asl rasmni ochish ↗
                    </a>
                  )}
                </div>
              </div>

              {/* AI & Anti-Fraud tahlili */}
              <div className="space-y-4">
                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    AI Xavfsizlik & Soxtalashtirish xulosasi
                  </h4>
                  <div className="mt-3 flex items-center justify-between">
                    <div>{getRiskBadge(inspectItem.fraudRisk, inspectItem.fraudScore)}</div>
                    <div className="text-xs font-semibold text-slate-700">
                      Xavf balli: {inspectItem.fraudScore} / 100
                    </div>
                  </div>

                  {inspectItem.fraudRisk === "HIGH" && (
                    <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
                      ⚠️ <b>OGOHLANTIRISH:</b> Ushbu chekda sun&apos;iy intellekt yoki grafik redaktor
                      yordamida soxtalashtirish/o&apos;zgartirish belgilari aniqlangan. Tasdiqlashdan
                      oldin bank hisobingizdan mablag&apos; haqiqatan tushganini qat&apos;iy tekshiring!
                    </div>
                  )}

                  {/* Aniqlangan sabablar */}
                  <div className="mt-4">
                    <p className="text-xs font-semibold text-slate-700">
                      Aniqlangan belgilar va tahlil:
                    </p>
                    {inspectItem.fraudFlags && inspectItem.fraudFlags.length > 0 ? (
                      <ul className="mt-2 space-y-1.5 text-xs text-slate-600">
                        {inspectItem.fraudFlags.map((flag, idx) => (
                          <li key={idx} className="flex items-start gap-2">
                            <span className="text-rose-500">•</span>
                            <span>{flag}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1 text-xs text-emerald-600">
                        ✓ Hech qanday shubhali redaktor yoki metadata o&apos;zgarishlari aniqlanmadi.
                      </p>
                    )}
                  </div>
                </div>

                {/* Ariza ma'lumotlari */}
                <div className="rounded-2xl border border-slate-100 p-4 text-xs space-y-2">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Haydovchi:</span>
                    <span className="font-medium text-slate-900">
                      {inspectItem.driver.fullName} ({inspectItem.driver.phone})
                    </span>
                  </div>
                  {inspectItem.vehicle && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">Avtomobil:</span>
                      <span className="font-medium text-slate-900">
                        {inspectItem.vehicle.plateNumber} · {inspectItem.vehicle.model}
                      </span>
                    </div>
                  )}
                  {inspectItem.transactionNumber && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">Tranzaksiya raqami:</span>
                      <span className="font-mono font-medium text-slate-900">
                        {inspectItem.transactionNumber}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-slate-500">Holat:</span>
                    <span>{getStatusBadge(inspectItem.status)}</span>
                  </div>
                  {inspectItem.rejectionReason && (
                    <div className="mt-2 rounded-lg bg-rose-50 p-2 text-rose-800">
                      <b>Rad etish sababi:</b> {inspectItem.rejectionReason}
                    </div>
                  )}
                </div>

                {/* Harakat tugmalari */}
                {inspectItem.status === "PENDING" && (
                  <div className="flex gap-3 pt-2">
                    <button
                      type="button"
                      className="btn-primary flex-1"
                      onClick={() => {
                        setApproveItem(inspectItem);
                        setApproveNote("");
                      }}
                    >
                      ✓ Tasdiqlash
                    </button>
                    <button
                      type="button"
                      className="btn-secondary flex-1 border-rose-200 text-rose-700 hover:bg-rose-50"
                      onClick={() => {
                        setRejectItem(inspectItem);
                        setRejectReason("");
                      }}
                    >
                      ✕ Rad etish
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. Tasdiqlash modali */}
      {approveItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-slate-900">To&apos;lovni tasdiqlash</h3>
            <p className="mt-1 text-xs text-slate-500">
              Mablag&apos; hisobingizga kelib tushganini tekshirganingizdan so&apos;ng tasdiqlang.
            </p>

            {modalError && (
              <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
                ⚠️ {modalError}
              </div>
            )}

            {((approveItem as any).receiptFileUrl ?? approveItem.receiptUrl) && (
              <div className="mt-3 flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50/50 p-2.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={(approveItem as any).receiptFileUrl ?? approveItem.receiptUrl}
                  alt="Chek"
                  className="h-12 w-12 rounded-lg object-cover border border-slate-200"
                />
                <div className="flex-1 min-w-0 text-xs">
                  <div className="font-medium text-slate-800 truncate">
                    To&apos;lov cheki ilova qilingan
                  </div>
                  {approveItem.transactionNumber && (
                    <div className="text-slate-500 font-mono text-[11px] truncate">
                      Tranzaksiya: {approveItem.transactionNumber}
                    </div>
                  )}
                </div>
                <a
                  href={(approveItem as any).receiptFileUrl ?? approveItem.receiptUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-semibold text-brand-600 hover:underline shrink-0"
                >
                  Katta ko&apos;rish ↗
                </a>
              </div>
            )}

            <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-xs space-y-2">
              <div className="flex justify-between">
                <span className="text-slate-500">Haydovchi:</span>
                <span className="font-medium text-slate-900">{approveItem.driver.fullName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Summa:</span>
                <span className="font-bold text-emerald-600">
                  {formatMoney(approveItem.amount)} {tc("sum")}
                </span>
              </div>
              {approveItem.vehicle && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Avtomobil:</span>
                  <span className="font-medium text-slate-900">
                    {approveItem.vehicle.plateNumber} · {approveItem.vehicle.model}
                  </span>
                </div>
              )}
            </div>

            <div className="mt-4">
              <label className="label" htmlFor="approve-note">
                Izoh (ixtiyoriy)
              </label>
              <input
                id="approve-note"
                type="text"
                className="input text-xs"
                placeholder="Masalan: Click orqali tushdi"
                value={approveNote}
                onChange={(e) => setApproveNote(e.target.value)}
              />
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                className="btn-secondary text-xs"
                onClick={() => {
                  setApproveItem(null);
                  setModalError(null);
                }}
                disabled={busy}
              >
                {tc("cancel")}
              </button>
              <button
                type="button"
                className="btn-primary text-xs"
                onClick={() => void handleApprove()}
                disabled={busy}
              >
                {busy ? t("approving") : "Tasdiqlash va kvitansiya berish"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. Rad etish modali */}
      {rejectItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-rose-600">To&apos;lov chekini rad etish</h3>
            <p className="mt-1 text-xs text-slate-500">
              Rad etish sababini kiriting. Ushbu sabab haydovchining Telegram botiga yuboriladi.
            </p>

            {modalError && (
              <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
                ⚠️ {modalError}
              </div>
            )}

            <div className="mt-4">
              <label className="label" htmlFor="reject-reason">
                Rad etish sababi
              </label>
              <textarea
                id="reject-reason"
                className="input text-xs"
                rows={3}
                placeholder={t("rejectReasonPlaceholder")}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                required
              />
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                className="btn-secondary text-xs"
                onClick={() => {
                  setRejectItem(null);
                  setModalError(null);
                }}
                disabled={busy}
              >
                {tc("cancel")}
              </button>
              <button
                type="button"
                className="btn-secondary text-xs border-rose-200 bg-rose-600 text-white hover:bg-rose-700"
                onClick={() => void handleReject()}
                disabled={busy}
              >
                {busy ? t("rejecting") : t("reject")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

