"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { apiRequest } from "@/lib/client-api";
import { formatDate, formatDateTime, formatMoney, useApi } from "@/lib/use-api";
import type { DriverItem, DriverProfile, Vehicle } from "@/lib/types";
import { Alert, EmptyState, Loading, PageHeader, StatusBadge } from "@/components/ui";
import { todayTashkent } from "@/lib/tashkent";
import { DriverAvatar, DriverDocuments } from "@/components/driver-documents";
import { exportToExcelTable } from "@/lib/export-excel";
import { formatUzPlate } from "@/lib/plate";
import { formatUzPhone } from "@/lib/phone";

export default function DriversPage() {
  const t = useTranslations("drivers");
  const tc = useTranslations("common");

  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const listPath = debounced ? `/drivers?q=${encodeURIComponent(debounced)}` : "/drivers";
  const list = useApi<{ items: DriverItem[] }>(listPath);
  const vehicles = useApi<{ items: Vehicle[] }>("/vehicles?includeInactive=true");

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [standaloneView, setStandaloneView] = useState(false);
  const profile = useApi<DriverProfile>(selectedId ? `/drivers/${selectedId}` : null);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("driver");
    if (id) {
      setSelectedId(id);
      setStandaloneView(true);
    }
  }, []);

  const profileModalOpen = !!selectedId && !standaloneView;

  useEffect(() => {
    if (!profileModalOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedId(null);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [profileModalOpen]);

  const [actionError, setActionError] = useState<string | null>(null);
  const [actionOk, setActionOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [assignVehicleId, setAssignVehicleId] = useState("");
  const [assignDate, setAssignDate] = useState(todayTashkent());
  const [assignAmount, setAssignAmount] = useState("");
  const [linkCodes, setLinkCodes] = useState<
    Record<string, { code: string; expiresAt: string }>
  >({});

  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    fullName: "",
    phone: "",
    licenseNumber: "",
    notes: "",
  });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  useEffect(() => {
    setAssignVehicleId("");
    setAssignDate(todayTashkent());
    setAssignAmount("");
    setActionError(null);
    setActionOk(null);
    setEditing(false);
    setEditError(null);
  }, [selectedId]);

  const activeVehicles = useMemo(
    () => (vehicles.data?.items ?? []).filter((vehicle) => vehicle.status !== "INACTIVE"),
    [vehicles.data],
  );

  async function refreshAll() {
    await Promise.all([list.reload(), profile.reload(), vehicles.reload()]);
  }

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setSaving(true);
    try {
      await apiRequest("/drivers", {
        method: "POST",
        body: {
          fullName,
          phone,
          ...(licenseNumber.trim() ? { licenseNumber: licenseNumber.trim() } : {}),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        },
      });
      setFullName("");
      setPhone("");
      setLicenseNumber("");
      setNotes("");
      await list.reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : tc("error"));
    } finally {
      setSaving(false);
    }
  }

  async function runAction(task: () => Promise<void>, success?: string) {
    setActionError(null);
    setActionOk(null);
    setBusy(true);
    try {
      await task();
      if (success) setActionOk(success);
      await refreshAll();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : tc("error"));
    } finally {
      setBusy(false);
    }
  }

  function onAssign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId || !assignVehicleId) return;
    void runAction(async () => {
      await apiRequest(`/drivers/${selectedId}/assign`, {
        method: "POST",
        body: {
          vehicleId: assignVehicleId,
          startDate: assignDate || todayTashkent(),
          ...(assignAmount.trim() ? { monthlyAmount: assignAmount.trim() } : {}),
        },
      });
      setAssignVehicleId("");
      setAssignAmount("");
    }, tc("success"));
  }

  function onUnassign() {
    if (!selectedId) return;
    void runAction(async () => {
      await apiRequest(`/drivers/${selectedId}/unassign`, {
        method: "POST",
        body: { endDate: todayTashkent() },
      });
    }, tc("success"));
  }

  function onLink(profileRow: DriverProfile) {
    void runAction(async () => {
      const result = await apiRequest<{ code: string; expiresAt: string }>(
        `/drivers/${profileRow.driver.id}/telegram-link`,
        { method: "POST" },
      );
      setLinkCodes((codes) => ({
        ...codes,
        [profileRow.driver.id]: result,
      }));
    });
  }

  function onToggleStatus(driver: DriverItem) {
    void runAction(async () => {
      await apiRequest(`/drivers/${driver.id}`, {
        method: "PATCH",
        body: { status: driver.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" },
      });
    }, tc("success"));
  }

  function startEditing(profileRow: DriverProfile) {
    setEditForm({
      fullName: profileRow.driver.fullName,
      phone: profileRow.driver.phone,
      licenseNumber: profileRow.driver.licenseNumber ?? "",
      notes: profileRow.driver.notes ?? "",
    });
    setEditError(null);
    setEditing(true);
  }

  async function onEditDriver(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId) return;
    setEditError(null);
    setEditSaving(true);
    try {
      await apiRequest(`/drivers/${selectedId}`, {
        method: "PATCH",
        body: {
          fullName: editForm.fullName.trim(),
          phone: editForm.phone.trim(),
          licenseNumber: editForm.licenseNumber.trim(),
          notes: editForm.notes.trim(),
        },
      });
      await refreshAll();
      setEditing(false);
      setActionError(null);
      setActionOk(t("driverUpdated"));
    } catch (err) {
      setEditError(err instanceof Error ? err.message : tc("error"));
    } finally {
      setEditSaving(false);
    }
  }

  const data =
    selectedId && profile.data?.driver.id === selectedId ? profile.data : null;

  function handleExportDriversExcel() {
    const items = list.data?.items ?? [];
    if (!items.length) return;
    const headers = [
      "F.I.Sh",
      "Telefon raqam",
      "Guvohnoma raqami",
      "Holati",
      "Biriktirilgan avtomobil",
      "Model",
      "Oylik plan",
      "To'langan summa",
      "Umumiy qarzdorlik",
      "Telegram ulanishi",
    ];
    const rows = items.map((d) => [
      d.fullName,
      d.phone,
      d.licenseNumber ?? "—",
      d.status,
      d.vehicle?.plateNumber ? formatUzPlate(d.vehicle.plateNumber) : "Biriktirilmagan",
      d.vehicle?.model ?? "—",
      d.month?.due ?? "0",
      d.month?.paid ?? "0",
      d.totalDebt ?? "0",
      d.telegram?.linked ? "Ulangan" : "Ulanmagan",
    ]);
    exportToExcelTable("Haydovchilar_royxati", "Haydovchilar", headers, rows);
  }

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      {!standaloneView && (
      <div className="card card-body mb-5">
        <h2 className="mb-4 text-sm font-bold text-slate-800">{t("addTitle")}</h2>
        <form onSubmit={onCreate} className="space-y-4">
          {formError && <Alert tone="error">{formError}</Alert>}
          <div className="form-grid">
            <div>
              <label className="label" htmlFor="driver-name">
                {t("fullName")}
              </label>
              <input
                id="driver-name"
                className="input"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                minLength={2}
                maxLength={160}
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="driver-phone">
                {t("phone")}
              </label>
              <input
                id="driver-phone"
                className="input"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="+998901234567"
                pattern="^\+?\d{9,15}$"
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="driver-license">
                {t("license")}
              </label>
              <input
                id="driver-license"
                className="input"
                maxLength={60}
                value={licenseNumber}
                onChange={(event) => setLicenseNumber(event.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="driver-notes">
                {t("notes")}
              </label>
              <input
                id="driver-notes"
                className="input"
                maxLength={500}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </div>
          </div>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? t("creating") : t("create")}
          </button>
        </form>
      </div>
      )}

      {(actionError || actionOk) && (
        <div className="mb-5">
          <Alert tone={actionError ? "error" : "success"}>{actionError ?? actionOk}</Alert>
        </div>
      )}

      {profileModalOpen && !data && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
          <div className="card card-body min-w-[240px]">
            <Loading label={tc("loading")} />
          </div>
        </div>
      )}

      {data && (
        <div
          className={
            standaloneView
              ? "card card-body mb-5"
              : "fixed inset-0 z-50 overflow-y-auto bg-slate-950/50 p-3 backdrop-blur-sm sm:p-6"
          }
          onClick={standaloneView ? undefined : () => setSelectedId(null)}
          role={standaloneView ? undefined : "dialog"}
          aria-modal={standaloneView ? undefined : true}
          aria-label={data.driver.fullName}
        >
          <div
            className={
              standaloneView
                ? undefined
                : "card card-body mx-auto my-2 max-w-5xl shadow-2xl sm:my-6"
            }
            onClick={standaloneView ? undefined : (event) => event.stopPropagation()}
          >
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <DriverAvatar driver={data.driver} size="lg" />
              <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-bold text-slate-900">{data.driver.fullName}</h2>
                <StatusBadge status={data.driver.status} label={data.driver.status} />
                {data.driver.telegram.linked && (
                  <span className="badge bg-blue-50 text-blue-700">{t("telegramLinked")}</span>
                )}
              </div>
              <p className="mt-1 text-sm text-slate-500">
                {formatUzPhone(data.driver.phone)}
                {data.driver.licenseNumber ? ` · ${data.driver.licenseNumber}` : ""}
              </p>
              {data.driver.notes && (
                <p className="mt-1 text-xs text-slate-400">{data.driver.notes}</p>
              )}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => startEditing(data)}
                disabled={busy}
              >
                ✏️ {t("editDriver")}
              </button>
              <button type="button" className="btn-secondary" onClick={() => onLink(data)} disabled={busy}>
                {t("generateCode")}
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  if (standaloneView) {
                    window.close();
                  } else {
                    setSelectedId(null);
                  }
                }}
              >
                {t("close")}
              </button>
            </div>
          </div>

          {editing && (
            <form
              onSubmit={onEditDriver}
              className="mb-5 space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4"
            >
              <h3 className="text-sm font-bold text-slate-800">{t("editDriverTitle")}</h3>
              {editError && <Alert tone="error">{editError}</Alert>}
              <div className="form-grid">
                <div>
                  <label className="label" htmlFor="edit-driver-name">
                    {t("fullName")}
                  </label>
                  <input
                    id="edit-driver-name"
                    className="input"
                    value={editForm.fullName}
                    onChange={(event) =>
                      setEditForm((form) => ({ ...form, fullName: event.target.value }))
                    }
                    minLength={2}
                    maxLength={160}
                    required
                  />
                </div>
                <div>
                  <label className="label" htmlFor="edit-driver-phone">
                    {t("phone")}
                  </label>
                  <input
                    id="edit-driver-phone"
                    className="input"
                    value={editForm.phone}
                    onChange={(event) =>
                      setEditForm((form) => ({ ...form, phone: event.target.value }))
                    }
                    placeholder="+998901234567"
                    pattern="^\+?\d{9,15}$"
                    required
                  />
                  <p className="mt-1 text-[11px] text-slate-400">{t("editDriverPhoneHint")}</p>
                </div>
                <div>
                  <label className="label" htmlFor="edit-driver-license">
                    {t("license")}
                  </label>
                  <input
                    id="edit-driver-license"
                    className="input"
                    maxLength={60}
                    value={editForm.licenseNumber}
                    onChange={(event) =>
                      setEditForm((form) => ({ ...form, licenseNumber: event.target.value }))
                    }
                  />
                </div>
                <div>
                  <label className="label" htmlFor="edit-driver-notes">
                    {t("notes")}
                  </label>
                  <input
                    id="edit-driver-notes"
                    className="input"
                    maxLength={500}
                    value={editForm.notes}
                    onChange={(event) =>
                      setEditForm((form) => ({ ...form, notes: event.target.value }))
                    }
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <button type="submit" className="btn-primary" disabled={editSaving}>
                  {editSaving ? tc("loading") : tc("save")}
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => {
                    setEditing(false);
                    setEditError(null);
                  }}
                >
                  {tc("cancel")}
                </button>
              </div>
            </form>
          )}

          {linkCodes[data.driver.id] && (
            <div className="mb-4 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3">
              <p className="text-xs text-blue-700">{t("codeHint")}</p>
              <p className="mt-1 select-all font-mono text-sm font-semibold text-blue-900">
                /start {linkCodes[data.driver.id].code}
              </p>
              <p className="mt-1 text-[11px] text-blue-600">
                {formatDateTime(linkCodes[data.driver.id].expiresAt)}
              </p>
            </div>
          )}

          <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {t("monthDue")}
              </p>
              <p className="mt-1 text-sm font-bold text-slate-900">
                {formatMoney(data.currentMonth.due)}
              </p>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {t("monthPaid")}
              </p>
              <p className="mt-1 text-sm font-bold text-emerald-700">
                {formatMoney(data.currentMonth.paid)}
              </p>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {t("monthDebt")}
              </p>
              <p className="mt-1 text-sm font-bold text-red-600">
                {formatMoney(data.currentMonth.debt)}
              </p>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {t("totalDebt")}
              </p>
              <p className="mt-1 text-sm font-bold text-red-600">
                {formatMoney(data.totalDebt)}
              </p>
            </div>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <div>
              <h3 className="mb-2 text-sm font-bold text-slate-800">{t("currentVehicle")}</h3>
              {data.currentVehicle ? (
                <div className="rounded-xl border border-slate-200 p-4">
                  <p className="font-mono text-base font-bold text-slate-900">
                    {formatUzPlate(data.currentVehicle.plateNumber)}
                  </p>
                  <p className="text-sm text-slate-600">{data.currentVehicle.model}</p>
                  {data.currentVehicle.routeName && (
                    <p className="text-xs text-sky-700">🛣 {data.currentVehicle.routeName}</p>
                  )}
                  <p className="mt-2 text-xs text-slate-500">
                    {t("monthlyPlan")}: {formatMoney(data.currentVehicle.monthlyFee)}
                  </p>
                  <p className="text-xs text-slate-400">
                    {t("assignedSince")}: {formatDate(data.currentVehicle.assignedSince)}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <a
                      href={`/api/proxy/registry/public-verify/${encodeURIComponent(
                        data.currentVehicle.plateNumber,
                      )}/pdf`}
                      className="btn-secondary inline-flex text-xs"
                    >
                      {t("downloadPdf")}
                    </a>
                    <button
                      type="button"
                      className="btn-ghost text-xs text-red-600"
                      onClick={onUnassign}
                      disabled={busy}
                    >
                      {t("unassign")}
                    </button>
                  </div>
                </div>
              ) : (
                <p className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
                  {t("noVehicle")}
                </p>
              )}
            </div>

            <div>
              <h3 className="mb-2 text-sm font-bold text-slate-800">{t("assignTitle")}</h3>
              <form onSubmit={onAssign} className="space-y-3 rounded-xl border border-slate-200 p-4">
                <div>
                  <label className="label" htmlFor="assign-vehicle">
                    {t("selectVehicle")}
                  </label>
                  <select
                    id="assign-vehicle"
                    className="select"
                    value={assignVehicleId}
                    onChange={(event) => setAssignVehicleId(event.target.value)}
                    required
                  >
                    <option value="">—</option>
                    {activeVehicles.map((vehicle) => {
                      const currentDriver = vehicle.assignments[0]?.driver.fullName;
                      return (
                        <option key={vehicle.id} value={vehicle.id}>
                          {formatUzPlate(vehicle.plateNumber)} · {vehicle.model}
                          {currentDriver ? ` (${currentDriver})` : ""}
                        </option>
                      );
                    })}
                  </select>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="label" htmlFor="assign-date">
                      {t("assignedSince")}
                    </label>
                    <input
                      id="assign-date"
                      type="date"
                      className="input"
                      value={assignDate}
                      onChange={(event) => setAssignDate(event.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label className="label" htmlFor="assign-amount">
                      {t("monthlyAmount")}
                    </label>
                    <input
                      id="assign-amount"
                      className="input"
                      inputMode="decimal"
                      placeholder={
                        data.currentVehicle ? data.currentVehicle.monthlyFee : "1500000"
                      }
                      value={assignAmount}
                      onChange={(event) => setAssignAmount(event.target.value)}
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={busy || !assignVehicleId}
                >
                  {t("assignSubmit")}
                </button>
              </form>
            </div>
          </div>

          <DriverDocuments driver={data.driver} onSaved={profile.reload} />

          <div className="mt-6">
            <h3 className="mb-2 text-sm font-bold text-slate-800">{t("months")}</h3>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t("period")}</th>
                    <th>{t("due")}</th>
                    <th>{t("paid")}</th>
                    <th>{t("debt")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.months.map((row) => (
                    <tr key={row.month}>
                      <td className="font-mono text-xs">{row.month}</td>
                      <td>{formatMoney(row.due)}</td>
                      <td className="text-emerald-700">{formatMoney(row.paid)}</td>
                      <td className={Number(row.debt) > 0 ? "font-semibold text-red-600" : ""}>
                        {formatMoney(row.debt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-6">
            <h3 className="mb-2 text-sm font-bold text-slate-800">{t("payments")}</h3>
            {data.payments.length === 0 ? (
              <EmptyState>{t("noPayments")}</EmptyState>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{tc("date")}</th>
                      <th>{t("currentVehicle")}</th>
                      <th>{tc("amount")}</th>
                      <th>{t("paymentDays")}</th>
                      <th>{tc("status")}</th>
                      <th>{t("notes")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.payments.map((payment) => (
                      <tr key={payment.id}>
                        <td className="text-xs text-slate-600">{formatDateTime(payment.paidAt)}</td>
                        <td className="font-mono text-xs">{formatUzPlate(payment.vehicle.plateNumber)}</td>
                        <td className="font-semibold text-slate-900">
                          {formatMoney(payment.amount)}
                        </td>
                        <td className="text-xs text-slate-600">
                          <p className="font-semibold">
                            {t("paidDays", { count: payment.days })}
                          </p>
                          <p className="text-[10px] text-slate-400">
                            {formatDate(payment.coveredFrom)} — {formatDate(payment.coveredUntil)}
                          </p>
                        </td>
                        <td>
                          <span className="badge bg-slate-100 text-slate-600">
                            {payment.method === "CASH" ? "Naqd" : "Plastik"}
                          </span>
                        </td>
                        <td className="text-xs text-slate-500">{payment.note ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          </div>
        </div>
      )}

      {!standaloneView && (
      <div className="card">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-bold text-slate-800">{t("title")}</h2>
            <button
              type="button"
              onClick={handleExportDriversExcel}
              className="btn-secondary flex items-center gap-1.5 px-3 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
            >
              <span>📊</span>
              <span>Excelga yuklash</span>
            </button>
          </div>
          <input
            className="input sm:max-w-sm"
            placeholder={t("searchPlaceholder")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        {list.loading ? (
          <Loading label={tc("loading")} />
        ) : list.error ? (
          <div className="p-5">
            <Alert tone="error">{list.error}</Alert>
          </div>
        ) : list.data?.items.length === 0 ? (
          <EmptyState>{t("empty")}</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("fullName")}</th>
                  <th>{t("phone")}</th>
                  <th>{t("currentVehicle")}</th>
                  <th>{t("workedToday")}</th>
                  <th>{t("monthDue")}</th>
                  <th>{t("monthPaid")}</th>
                  <th>{t("totalDebt")}</th>
                  <th>{t("telegram")}</th>
                  <th>{tc("actions")}</th>
                </tr>
              </thead>
              <tbody>
                {list.data?.items.map((driver) => (
                  <tr key={driver.id}>
                    <td>
                      <div className="flex items-center gap-3">
                        <DriverAvatar driver={driver} size="sm" />
                        <div>
                          <p className="font-semibold text-slate-900">{driver.fullName}</p>
                          <StatusBadge status={driver.status} label={driver.status} />
                        </div>
                      </div>
                    </td>
                    <td className="font-mono text-xs">{formatUzPhone(driver.phone)}</td>
                    <td>
                      {driver.vehicle ? (
                        <>
                          <p className="font-mono text-xs font-semibold text-slate-800">
                            {formatUzPlate(driver.vehicle.plateNumber)}
                          </p>
                          <p className="text-[11px] text-slate-400">{driver.vehicle.model}</p>
                        </>
                      ) : (
                        <span className="text-xs text-slate-400">{t("noVehicle")}</span>
                      )}
                    </td>
                    <td>
                      {driver.workedToday ? (
                        <div className="space-y-0.5">
                          <span className="badge bg-emerald-50 text-emerald-700">
                            ✅ {t("workedToday")}
                          </span>
                          <p className="text-[10px] text-slate-500">
                            {t("paidDays", { count: driver.paidDays })}
                            {driver.coveredUntil
                              ? ` · ${formatDate(driver.coveredUntil)}`
                              : ""}
                          </p>
                        </div>
                      ) : (
                        <span className="badge bg-slate-100 text-slate-500">
                          {t("notPaidToday")}
                        </span>
                      )}
                    </td>
                    <td>{formatMoney(driver.month.due)}</td>
                    <td className="text-emerald-700">{formatMoney(driver.month.paid)}</td>
                    <td className="font-semibold text-red-600">
                      {formatMoney(driver.totalDebt)}
                    </td>
                    <td className="text-xs">
                      {driver.telegram.linked ? (
                        <span className="badge bg-blue-50 text-blue-700">
                          {t("telegramLinked")}
                        </span>
                      ) : (
                        <span className="text-slate-400">{t("telegramNotLinked")}</span>
                      )}
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          className="btn-ghost text-xs"
                          onClick={() => setSelectedId(driver.id)}
                        >
                          {t("profile")}
                        </button>
                        <button
                          type="button"
                          className="btn-ghost text-xs text-slate-500"
                          onClick={() => onToggleStatus(driver)}
                          disabled={busy}
                        >
                          {driver.status === "ACTIVE" ? "Faolsizlantirish" : "Faollashtirish"}
                        </button>
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
    </>
  );
}
