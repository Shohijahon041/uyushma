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
  const profile = useApi<DriverProfile>(selectedId ? `/drivers/${selectedId}` : null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionOk, setActionOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [assignVehicleId, setAssignVehicleId] = useState("");
  const [assignDate, setAssignDate] = useState(todayTashkent());
  const [assignAmount, setAssignAmount] = useState("");
  const [assignVehFilter, setAssignVehFilter] = useState("");
  const [linkCodes, setLinkCodes] = useState<
    Record<string, { code: string; expiresAt: string }>
  >({});

  // Dedicated "Avtomobil biriktirish" with Driver Search modal state
  const [globalAssignOpen, setGlobalAssignOpen] = useState(false);
  const [modalDriverSearch, setModalDriverSearch] = useState("");
  const [modalDriverSearching, setModalDriverSearching] = useState(false);
  const [modalSearchedDrivers, setModalSearchedDrivers] = useState<DriverItem[]>([]);
  const [modalSelectedDriver, setModalSelectedDriver] = useState<DriverItem | null>(null);
  const [modalVehicleId, setModalVehicleId] = useState("");
  const [modalVehFilter, setModalVehFilter] = useState("");
  const [modalDate, setModalDate] = useState(todayTashkent());
  const [modalAmount, setModalAmount] = useState("");
  const [modalSaving, setModalSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  useEffect(() => {
    setAssignVehicleId("");
    setAssignVehFilter("");
    setAssignDate(todayTashkent());
    setAssignAmount("");
    setActionError(null);
    setActionOk(null);
  }, [selectedId]);

  const activeVehicles = useMemo(
    () => (vehicles.data?.items ?? []).filter((vehicle) => vehicle.status !== "INACTIVE"),
    [vehicles.data],
  );

  const filteredActiveVehicles = useMemo(() => {
    const q = assignVehFilter.trim().toLowerCase();
    if (!q) return activeVehicles;
    return activeVehicles.filter(
      (v) =>
        v.plateNumber.toLowerCase().includes(q) ||
        v.model.toLowerCase().includes(q) ||
        (v.assignments[0]?.driver.fullName &&
          v.assignments[0].driver.fullName.toLowerCase().includes(q)),
    );
  }, [activeVehicles, assignVehFilter]);

  const modalFilteredVehicles = useMemo(() => {
    const q = modalVehFilter.trim().toLowerCase();
    if (!q) return activeVehicles;
    return activeVehicles.filter(
      (v) =>
        v.plateNumber.toLowerCase().includes(q) ||
        v.model.toLowerCase().includes(q) ||
        (v.assignments[0]?.driver.fullName &&
          v.assignments[0].driver.fullName.toLowerCase().includes(q)),
    );
  }, [activeVehicles, modalVehFilter]);

  async function searchModalDrivers(q: string) {
    setModalDriverSearching(true);
    try {
      const query = q.trim();
      const res = await apiRequest<{ items: DriverItem[] }>(
        query ? `/drivers?q=${encodeURIComponent(query)}` : "/drivers",
      );
      setModalSearchedDrivers(res.items || []);
    } catch {
      setModalSearchedDrivers([]);
    } finally {
      setModalDriverSearching(false);
    }
  }

  function triggerModalDriverSearch() {
    void searchModalDrivers(modalDriverSearch);
  }

  function openGlobalAssign(driver?: DriverItem | { id: string; fullName: string; phone: string; vehicle?: any }) {
    if (driver) {
      setModalSelectedDriver({
        id: driver.id,
        fullName: driver.fullName,
        phone: driver.phone,
        licenseNumber: (driver as any).licenseNumber ?? null,
        status: "ACTIVE",
        notes: null,
        telegram: { linked: false, username: null, linkedAt: null, hasPhoto: false },
        vehicle: (driver as any).vehicle ?? null,
        month: { period: "", due: "0", paid: "0", debt: "0", surplus: "0" },
        totalDebt: "0",
        workedToday: false,
        paidDays: 0,
        coveredUntil: null,
      });
    } else {
      setModalSelectedDriver(null);
    }
    setModalDriverSearch("");
    setModalVehicleId("");
    setModalVehFilter("");
    setModalDate(todayTashkent());
    setModalAmount("");
    setModalError(null);
    setGlobalAssignOpen(true);
    void searchModalDrivers("");
  }

  useEffect(() => {
    if (!globalAssignOpen) return;
    const timer = setTimeout(() => {
      void searchModalDrivers(modalDriverSearch);
    }, 250);
    return () => clearTimeout(timer);
  }, [modalDriverSearch, globalAssignOpen]);

  async function handleModalAssignSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!modalSelectedDriver || !modalVehicleId) return;
    setModalSaving(true);
    setModalError(null);
    try {
      await apiRequest(`/drivers/${modalSelectedDriver.id}/assign`, {
        method: "POST",
        body: {
          vehicleId: modalVehicleId,
          startDate: modalDate || todayTashkent(),
          ...(modalAmount.trim() ? { monthlyAmount: modalAmount.trim() } : {}),
        },
      });
      setActionOk(`${modalSelectedDriver.fullName} ga avtomobil muvaffaqiyatli biriktirildi!`);
      setGlobalAssignOpen(false);
      await refreshAll();
    } catch (err) {
      setModalError(err instanceof Error ? err.message : tc("error"));
    } finally {
      setModalSaving(false);
    }
  }

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

  const data = profile.data;

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
      d.vehicle?.plateNumber ?? "Biriktirilmagan",
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

      {(actionError || actionOk) && (
        <div className="mb-5">
          <Alert tone={actionError ? "error" : "success"}>{actionError ?? actionOk}</Alert>
        </div>
      )}

      {data && (
        <div className="card card-body mb-5">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <DriverAvatar driver={data.driver} />
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-bold text-slate-900">{data.driver.fullName}</h2>
                  <StatusBadge status={data.driver.status} label={data.driver.status} />
                  {data.driver.telegram.linked && (
                    <span className="badge bg-blue-50 text-blue-700">{t("telegramLinked")}</span>
                  )}
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  {data.driver.phone}
                  {data.driver.licenseNumber ? ` · ${data.driver.licenseNumber}` : ""}
                </p>
                {data.driver.notes && (
                  <p className="mt-1 text-xs text-slate-400">{data.driver.notes}</p>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <button type="button" className="btn-secondary" onClick={() => onLink(data)} disabled={busy}>
                {t("generateCode")}
              </button>
              <button type="button" className="btn-ghost" onClick={() => setSelectedId(null)}>
                {t("close")}
              </button>
            </div>
          </div>

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
                    {data.currentVehicle.plateNumber}
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
                  <button
                    type="button"
                    className="btn-ghost mt-3 text-xs text-red-600"
                    onClick={onUnassign}
                    disabled={busy}
                  >
                    {t("unassign")}
                  </button>
                </div>
              ) : (
                <p className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
                  {t("noVehicle")}
                </p>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-bold text-slate-800">{t("assignTitle")}</h3>
                <button
                  type="button"
                  onClick={() => openGlobalAssign(data.driver)}
                  className="btn-secondary text-xs flex items-center gap-1.5"
                >
                  🔍 Haydovchini qidirish va almashtirish
                </button>
              </div>
              <form onSubmit={onAssign} className="space-y-3 rounded-xl border border-slate-200 p-4">
                <div>
                  <label className="label" htmlFor="assign-vehicle">
                    {t("selectVehicle")}
                  </label>
                  <input
                    type="text"
                    className="input text-xs mb-1.5 w-full bg-slate-50 focus:bg-white"
                    placeholder="🔍 Avtomobilni qidirish (davlat raqami yoki model)..."
                    value={assignVehFilter}
                    onChange={(e) => setAssignVehFilter(e.target.value)}
                  />
                  <select
                    id="assign-vehicle"
                    className="select"
                    value={assignVehicleId}
                    onChange={(event) => setAssignVehicleId(event.target.value)}
                    required
                  >
                    <option value="">—</option>
                    {filteredActiveVehicles.map((vehicle) => {
                      const currentDriver = vehicle.assignments[0]?.driver.fullName;
                      return (
                        <option key={vehicle.id} value={vehicle.id}>
                          {vehicle.plateNumber} · {vehicle.model}
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
                      <th>{tc("status")}</th>
                      <th>{t("notes")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.payments.map((payment) => (
                      <tr key={payment.id}>
                        <td className="text-xs text-slate-600">{formatDateTime(payment.paidAt)}</td>
                        <td className="font-mono text-xs">{payment.vehicle.plateNumber}</td>
                        <td className="font-semibold text-slate-900">
                          {formatMoney(payment.amount)}
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
      )}

      <div className="card">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-slate-800">{t("title")}</h2>
            <button
              type="button"
              onClick={() => openGlobalAssign()}
              className="btn-primary flex items-center gap-1 px-3 py-1 text-xs font-semibold shadow-sm"
            >
              <span>🔗</span>
              <span>Avtomobil biriktirish</span>
            </button>
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
                      <p className="font-semibold text-slate-900">{driver.fullName}</p>
                      <StatusBadge status={driver.status} label={driver.status} />
                    </td>
                    <td className="font-mono text-xs">{driver.phone}</td>
                    <td>
                      {driver.vehicle ? (
                        <>
                          <p className="font-mono text-xs font-semibold text-slate-800">
                            {driver.vehicle.plateNumber}
                          </p>
                          <p className="text-[11px] text-slate-400">{driver.vehicle.model}</p>
                        </>
                      ) : (
                        <span className="text-xs text-slate-400">{t("noVehicle")}</span>
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
                          className="btn-ghost text-xs text-emerald-700 font-semibold"
                          onClick={() => openGlobalAssign(driver)}
                        >
                          🔗 Biriktirish
                        </button>
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

      {/* Avtomobil biriktirish (Driver Search + Vehicle Search) Modal */}
      {globalAssignOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm animate-fadeIn">
          <div className="card w-full max-w-lg p-5 bg-white shadow-2xl rounded-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b pb-3 mb-4">
              <div>
                <h3 className="text-base font-bold text-slate-900">Avtomobil biriktirish</h3>
                <p className="text-xs text-slate-500">
                  Haydovchini qidirish va unga avtomobil biriktirish
                </p>
              </div>
              <button
                type="button"
                onClick={() => setGlobalAssignOpen(false)}
                className="text-slate-400 hover:text-slate-700 text-lg font-bold p-1 rounded-lg"
              >
                ✕
              </button>
            </div>

            {/* Step 1: Driver Search & Selection */}
            <div className="mb-4">
              <label className="label font-bold text-xs text-slate-800 mb-1 flex items-center justify-between">
                <span>1. Haydovchini tanlang</span>
                {modalSelectedDriver && (
                  <button
                    type="button"
                    onClick={() => setModalSelectedDriver(null)}
                    className="text-xs text-blue-600 hover:underline font-normal"
                  >
                    Boshqa haydovchi qidirish
                  </button>
                )}
              </label>

              {modalSelectedDriver ? (
                <div className="p-3 bg-emerald-50 border border-emerald-300 rounded-xl flex items-center justify-between">
                  <div>
                    <div className="font-bold text-sm text-emerald-950">
                      ✅ {modalSelectedDriver.fullName}
                    </div>
                    <div className="text-xs text-emerald-800 font-mono mt-0.5">
                      📞 {formatUzPhone(modalSelectedDriver.phone)}{" "}
                      {modalSelectedDriver.vehicle
                        ? `· Hozirgi: ${formatUzPlate(modalSelectedDriver.vehicle.plateNumber)} (${modalSelectedDriver.vehicle.model})`
                        : "· Avtomobil biriktirilmagan"}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setModalSelectedDriver(null)}
                    className="btn-ghost text-xs text-slate-700 border border-emerald-300 bg-white"
                  >
                    O&apos;zgartirish
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      className="input flex-1 text-xs"
                      placeholder="Haydovchi F.I.Sh yoki telefon raqamini kiriting..."
                      value={modalDriverSearch}
                      onChange={(e) => setModalDriverSearch(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          triggerModalDriverSearch();
                        }
                      }}
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={triggerModalDriverSearch}
                      className="btn-secondary px-3 py-1.5 text-xs font-semibold flex items-center gap-1 whitespace-nowrap shadow-sm"
                    >
                      🔍 Qidirish
                    </button>
                  </div>

                  {/* Driver search results list */}
                  <div className="border border-slate-200 rounded-xl max-h-44 overflow-y-auto divide-y divide-slate-100 bg-white shadow-inner">
                    {modalDriverSearching ? (
                      <div className="p-4 text-center text-xs text-slate-500">Qidirilmoqda...</div>
                    ) : modalSearchedDrivers.length === 0 ? (
                      <div className="p-4 text-center text-xs text-slate-400">
                        {modalDriverSearch
                          ? "Mos keluvchi haydovchi topilmadi"
                          : "Haydovchini topish uchun ism yoki telefon kiriting"}
                      </div>
                    ) : (
                      modalSearchedDrivers.map((d) => (
                        <div
                          key={d.id}
                          className="p-2.5 flex items-center justify-between hover:bg-slate-50 transition cursor-pointer"
                          onClick={() => setModalSelectedDriver(d)}
                        >
                          <div>
                            <p className="font-semibold text-xs text-slate-900">{d.fullName}</p>
                            <p className="font-mono text-[11px] text-slate-500">
                              {formatUzPhone(d.phone)}{" "}
                              {d.vehicle
                                ? `· Hozirgi: ${formatUzPlate(d.vehicle.plateNumber)} (${d.vehicle.model})`
                                : "· Mashinasiz"}
                            </p>
                          </div>
                          <button
                            type="button"
                            className="btn-secondary text-xs px-2.5 py-1 text-emerald-700 hover:bg-emerald-50"
                            onClick={(e) => {
                              e.stopPropagation();
                              setModalSelectedDriver(d);
                            }}
                          >
                            Tanlash
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Step 2: Vehicle Selection with search */}
            <form onSubmit={handleModalAssignSubmit} className="space-y-3">
              <div>
                <label className="label font-bold text-xs text-slate-800 mb-1">
                  2. Avtomobilni tanlang
                </label>
                <input
                  type="text"
                  className="input text-xs mb-1.5 w-full bg-slate-50 focus:bg-white"
                  placeholder="🔍 Avtomobilni qidirish (davlat raqami yoki model)..."
                  value={modalVehFilter}
                  onChange={(e) => setModalVehFilter(e.target.value)}
                />
                <select
                  className="select w-full text-xs"
                  value={modalVehicleId}
                  onChange={(e) => setModalVehicleId(e.target.value)}
                  required
                >
                  <option value="">— Avtomobilni tanlang —</option>
                  {modalFilteredVehicles.map((vehicle) => {
                    const currentDriver = vehicle.assignments[0]?.driver.fullName;
                    return (
                      <option key={vehicle.id} value={vehicle.id}>
                        {formatUzPlate(vehicle.plateNumber)} · {vehicle.model}
                        {currentDriver ? ` (Hozirgi haydovchi: ${currentDriver})` : " (Bo'sh)"}
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* Step 3: Date & Monthly Fee */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label text-xs">Biriktirilgan sana</label>
                  <input
                    type="date"
                    className="input text-xs"
                    value={modalDate}
                    onChange={(e) => setModalDate(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="label text-xs">Oylik plan (so&apos;m)</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    className="input text-xs"
                    placeholder="1500000"
                    value={modalAmount}
                    onChange={(e) => setModalAmount(e.target.value)}
                  />
                </div>
              </div>

              {modalError && <Alert tone="error">{modalError}</Alert>}

              <div className="flex justify-end gap-2 pt-3 border-t mt-4">
                <button
                  type="button"
                  className="btn-secondary text-xs"
                  onClick={() => setGlobalAssignOpen(false)}
                  disabled={modalSaving}
                >
                  Bekor qilish
                </button>
                <button
                  type="submit"
                  className="btn-primary text-xs"
                  disabled={modalSaving || !modalSelectedDriver || !modalVehicleId}
                >
                  {modalSaving ? "Biriktirilmoqda..." : "✅ Biriktirish"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
