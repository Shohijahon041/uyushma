"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { apiRequest } from "@/lib/client-api";
import { formatDate, formatDateTime, formatMoney, useApi } from "@/lib/use-api";
import type { DriverItem, DriverProfile, Vehicle } from "@/lib/types";
import { Alert, EmptyState, Loading, PageHeader, StatusBadge } from "@/components/ui";
import { Icon } from "@/components/icons";
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
  const [addOpen, setAddOpen] = useState(false);

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
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const profileRef = useRef<HTMLDivElement | null>(null);

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

  useEffect(() => {
    if (!globalAssignOpen) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const focusable = () =>
      dialog
        ? Array.from(
            dialog.querySelectorAll<HTMLElement>(
              'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ),
          ).filter((element) => element.offsetParent !== null)
        : [];
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setGlobalAssignOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [globalAssignOpen]);

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
      setAddOpen(false);
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

  function onToggleStatus(driver: { id: string; status: "ACTIVE" | "INACTIVE" }) {
    void runAction(async () => {
      await apiRequest(`/drivers/${driver.id}`, {
        method: "PATCH",
        body: { status: driver.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" },
      });
    }, tc("success"));
  }

  const data = profile.data;

  useEffect(() => {
    if (!data?.driver.id || !profileRef.current) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    profileRef.current.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "start",
    });
    // selectedId ham kerak: keshdan qaytgan bir xil haydovchi qayta ochilganda
    // faqat driver.id o'zgarmay, profil ko'rinmay qoladi.
  }, [selectedId, data?.driver.id]);

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

      <div className="card mb-5">
        <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <h2 className="text-sm font-bold text-slate-800">{t("addTitle")}</h2>
          <button
            type="button"
            className={addOpen ? "btn-ghost" : "btn-secondary"}
            onClick={() => setAddOpen((open) => !open)}
            aria-expanded={addOpen}
            aria-controls="driver-add-form"
          >
            <Icon name={addOpen ? "x" : "plus"} className="h-4 w-4" />
            {addOpen ? t("close") : t("create")}
          </button>
        </div>
        {addOpen && (
          <div id="driver-add-form" className="card-body border-t border-slate-100 pt-4 sm:pt-5">
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
                    type="tel"
                    autoComplete="tel"
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
      </div>

      {(actionError || actionOk) && (
        <div className="mb-5">
          <Alert tone={actionError ? "error" : "success"}>{actionError ?? actionOk}</Alert>
        </div>
      )}

      {data && (
        <div ref={profileRef} className="card card-body mb-5 scroll-mt-36 md:scroll-mt-20">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <DriverAvatar driver={data.driver} />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-bold text-slate-900">{data.driver.fullName}</h2>
                  <StatusBadge status={data.driver.status} label={t(data.driver.status)} />
                  {data.driver.telegram.linked && (
                    <span className="badge bg-blue-50 text-blue-700">{t("telegramLinked")}</span>
                  )}
                </div>
                <p className="mt-1 font-mono text-sm text-slate-600">
                  {formatUzPhone(data.driver.phone)}
                  {data.driver.licenseNumber ? ` · ${data.driver.licenseNumber}` : ""}
                </p>
                {data.driver.notes && (
                  <p className="mt-1 text-xs text-slate-500">{data.driver.notes}</p>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-secondary" onClick={() => onLink(data)} disabled={busy}>
                <Icon name="link" className="h-4 w-4" />
                {t("generateCode")}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => onToggleStatus(data.driver)}
                disabled={busy}
              >
                <Icon name={data.driver.status === "ACTIVE" ? "ban" : "check"} className="h-4 w-4" />
                {data.driver.status === "ACTIVE" ? t("deactivate") : t("activate")}
              </button>
              <button type="button" className="btn-ghost" onClick={() => setSelectedId(null)}>
                <Icon name="x" className="h-4 w-4" />
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
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {t("monthDue")}
              </p>
              <p className="mt-1 text-sm font-bold tabular-nums text-slate-900">
                {formatMoney(data.currentMonth.due)}
              </p>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {t("monthPaid")}
              </p>
              <p className="mt-1 text-sm font-bold tabular-nums text-emerald-700">
                {formatMoney(data.currentMonth.paid)}
              </p>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {t("monthDebt")}
              </p>
              <p className="mt-1 text-sm font-bold tabular-nums text-red-700">
                {formatMoney(data.currentMonth.debt)}
              </p>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {t("totalDebt")}
              </p>
              <p className="mt-1 text-sm font-bold tabular-nums text-red-700">
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
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-sky-700">
                      <Icon name="map" className="h-3.5 w-3.5" />
                      {data.currentVehicle.routeName}
                    </p>
                  )}
                  <p className="mt-2 text-xs text-slate-600">
                    {t("monthlyPlan")}: {formatMoney(data.currentVehicle.monthlyFee)}
                  </p>
                  <p className="text-xs text-slate-500">
                    {t("assignedSince")}: {formatDate(data.currentVehicle.assignedSince)}
                  </p>
                  <button
                    type="button"
                    className="btn-danger mt-3 text-xs"
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
                  className="btn-secondary flex items-center gap-1.5 text-xs"
                >
                  <Icon name="search" className="h-3.5 w-3.5" />
                  Haydovchini almashtirish
                </button>
              </div>
              <form onSubmit={onAssign} className="space-y-3 rounded-xl border border-slate-200 p-4">
                <div>
                  <label className="label" htmlFor="assign-vehicle">
                    {t("selectVehicle")}
                  </label>
                  <input
                    type="text"
                    className="input mb-1.5 w-full bg-slate-50 text-xs focus:bg-white"
                    placeholder="Avtomobilni qidirish (davlat raqami yoki model)..."
                    aria-label="Avtomobilni qidirish"
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
                      <td className={Number(row.debt) > 0 ? "font-semibold text-red-700" : ""}>
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
        <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-bold text-slate-800">{t("title")}</h2>
            {list.data && list.data.items.length > 0 && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-slate-600">
                {list.data.items.length}
              </span>
            )}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between lg:justify-end">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => openGlobalAssign()}
                className="btn-secondary text-xs"
              >
                <Icon name="link" className="h-4 w-4" />
                {t("assign")}
              </button>
              <button
                type="button"
                onClick={handleExportDriversExcel}
                className="btn-secondary text-xs"
              >
                <Icon name="download" className="h-4 w-4" />
                {t("exportExcel")}
              </button>
            </div>
            <div className="relative sm:w-72">
              <label htmlFor="driver-search" className="sr-only">
                {t("searchPlaceholder")}
              </label>
              <Icon
                name="search"
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              />
              <input
                id="driver-search"
                type="search"
                className="input pl-9"
                placeholder={t("searchPlaceholder")}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          </div>
        </div>
        {list.loading ? (
          <Loading label={tc("loading")} />
        ) : list.error ? (
          <div className="p-5">
            <Alert tone="error">{list.error}</Alert>
          </div>
        ) : list.data?.items.length === 0 ? (
          <EmptyState>{debounced ? t("searchEmpty") : t("empty")}</EmptyState>
        ) : (
          <>
            <ul className="divide-y divide-slate-100 xl:hidden">
              {list.data?.items.map((driver) => (
                <li key={driver.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedId(driver.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedId(driver.id);
                      }
                    }}
                    className="flex w-full cursor-pointer items-start gap-3 px-4 py-4 text-left transition hover:bg-slate-50/70 active:bg-slate-100 focus:outline-none focus-visible:bg-brand-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500"
                    aria-label={`${driver.fullName} — ${t("profile")}`}
                  >
                    <DriverAvatar driver={driver} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <p className="font-semibold text-slate-900">{driver.fullName}</p>
                        <StatusBadge status={driver.status} label={t(driver.status)} />
                        {driver.telegram.linked && (
                          <span className="badge bg-blue-50 text-blue-700">
                            {t("telegramLinked")}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 font-mono text-xs text-slate-500">
                        {formatUzPhone(driver.phone)}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                        {driver.vehicle ? (
                          <span className="font-mono text-xs font-semibold text-slate-800">
                            {formatUzPlate(driver.vehicle.plateNumber)}
                            <span className="ml-2 font-sans font-normal text-slate-500">
                              {driver.vehicle.model}
                            </span>
                          </span>
                        ) : (
                          <span className="text-slate-500">{t("noVehicle")}</span>
                        )}
                        {driver.workedToday ? (
                          <span className="badge gap-1 bg-emerald-50 text-emerald-700">
                            <Icon name="check" className="h-3.5 w-3.5" />
                            {t("workedToday")}
                          </span>
                        ) : (
                          <span className="badge bg-slate-100 text-slate-600">
                            {t("notPaidToday")}
                          </span>
                        )}
                      </div>
                      <dl className="mt-2 space-y-1 rounded-lg bg-slate-50 px-3 py-2 text-xs">
                        <div className="flex items-baseline justify-between gap-3">
                          <dt className="text-slate-500">{t("due")}</dt>
                          <dd className="font-semibold tabular-nums text-slate-800">
                            {formatMoney(driver.month.due)}
                          </dd>
                        </div>
                        <div className="flex items-baseline justify-between gap-3">
                          <dt className="text-slate-500">{t("paid")}</dt>
                          <dd className="font-semibold tabular-nums text-emerald-700">
                            {formatMoney(driver.month.paid)}
                          </dd>
                        </div>
                        <div className="flex items-baseline justify-between gap-3">
                          <dt className="text-slate-500">{t("totalDebt")}</dt>
                          <dd className="font-semibold tabular-nums text-red-700">
                            {formatMoney(driver.totalDebt)}
                          </dd>
                        </div>
                      </dl>
                    </div>
                    <Icon
                      name="chevron-right"
                      className="mt-1 h-4 w-4 shrink-0 text-slate-400"
                    />
                  </div>
                </li>
              ))}
            </ul>

            <div className="table-wrap hidden xl:block">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t("fullName")}</th>
                    <th>{t("currentVehicle")}</th>
                    <th>{t("workedToday")}</th>
                    <th>{t("monthSummary")}</th>
                    <th>{t("telegram")}</th>
                    <th className="w-14">
                      <span className="sr-only">{tc("actions")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.data?.items.map((driver) => (
                    <tr
                      key={driver.id}
                      onClick={() => setSelectedId(driver.id)}
                      title={t("profile")}
                      className="cursor-pointer"
                    >
                      <td>
                        <div className="flex items-center gap-3">
                          <DriverAvatar driver={driver} size="sm" />
                          <div className="min-w-0">
                            <p className="font-semibold text-slate-900">{driver.fullName}</p>
                            <div className="mt-0.5 flex flex-wrap items-center gap-2">
                              <StatusBadge status={driver.status} label={t(driver.status)} />
                              <span className="font-mono text-xs text-slate-500">
                                {formatUzPhone(driver.phone)}
                              </span>
                            </div>
                          </div>
                        </div>
                      </td>
                      <td>
                        {driver.vehicle ? (
                          <>
                            <p className="font-mono text-xs font-semibold text-slate-800">
                              {formatUzPlate(driver.vehicle.plateNumber)}
                            </p>
                            <p className="text-xs text-slate-500">{driver.vehicle.model}</p>
                          </>
                        ) : (
                          <span className="text-xs text-slate-500">{t("noVehicle")}</span>
                        )}
                      </td>
                      <td>
                        {driver.workedToday ? (
                          <div className="space-y-0.5">
                            <span className="badge gap-1 bg-emerald-50 text-emerald-700">
                              <Icon name="check" className="h-3.5 w-3.5" />
                              {t("workedToday")}
                            </span>
                            <p className="text-xs text-slate-500">
                              {t("paidDays", { count: driver.paidDays })}
                              {driver.coveredUntil
                                ? ` · ${formatDate(driver.coveredUntil)}`
                                : ""}
                            </p>
                          </div>
                        ) : (
                          <span className="badge bg-slate-100 text-slate-600">
                            {t("notPaidToday")}
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap">
                        <div className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-0.5 text-xs">
                          <span className="text-slate-500">{t("due")}</span>
                          <span className="text-right font-semibold tabular-nums text-slate-800">
                            {formatMoney(driver.month.due)}
                          </span>
                          <span className="text-slate-500">{t("paid")}</span>
                          <span className="text-right font-semibold tabular-nums text-emerald-700">
                            {formatMoney(driver.month.paid)}
                          </span>
                          <span className="text-slate-500">{t("totalDebt")}</span>
                          <span className="text-right font-semibold tabular-nums text-red-700">
                            {formatMoney(driver.totalDebt)}
                          </span>
                        </div>
                      </td>
                      <td className="text-xs">
                        {driver.telegram.linked ? (
                          <span className="badge bg-blue-50 text-blue-700">
                            {t("telegramLinked")}
                          </span>
                        ) : (
                          <span className="text-slate-500">{t("telegramNotLinked")}</span>
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedId(driver.id);
                          }}
                          aria-label={`${driver.fullName} — ${t("profile")}`}
                          className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
                        >
                          <Icon name="chevron-right" className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Avtomobil biriktirish (Driver Search + Vehicle Search) Modal */}
      {globalAssignOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 backdrop-blur-sm animate-fadeIn sm:items-center"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setGlobalAssignOpen(false);
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="assign-modal-title"
            className="card w-full max-w-lg p-5 bg-white shadow-2xl rounded-2xl max-h-[calc(100dvh-1rem)] overflow-y-auto sm:max-h-[90vh]"
          >
            <div className="flex items-start justify-between gap-3 border-b pb-3 mb-4">
              <div>
                <h3 id="assign-modal-title" className="text-base font-bold text-slate-900">
                  Avtomobil biriktirish
                </h3>
                <p className="text-xs text-slate-500">
                  Haydovchini qidirish va unga avtomobil biriktirish
                </p>
              </div>
              <button
                type="button"
                onClick={() => setGlobalAssignOpen(false)}
                aria-label={tc("close")}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
              >
                <Icon name="x" className="h-5 w-5" />
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
                <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-300 bg-emerald-50 p-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-sm font-bold text-emerald-950">
                      <Icon name="check" className="h-4 w-4 shrink-0" />
                      {modalSelectedDriver.fullName}
                    </p>
                    <p className="mt-0.5 flex items-center gap-1.5 font-mono text-xs text-emerald-800">
                      <Icon name="phone" className="h-3.5 w-3.5 shrink-0" />
                      <span className="min-w-0 truncate">
                        {formatUzPhone(modalSelectedDriver.phone)}
                        {modalSelectedDriver.vehicle
                          ? ` · Hozirgi: ${formatUzPlate(modalSelectedDriver.vehicle.plateNumber)} (${modalSelectedDriver.vehicle.model})`
                          : " · Avtomobil biriktirilmagan"}
                      </span>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setModalSelectedDriver(null)}
                    className="btn-secondary shrink-0 text-xs"
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
                      aria-label="Haydovchini qidirish"
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
                      className="btn-secondary shrink-0 text-xs"
                    >
                      <Icon name="search" className="h-4 w-4" />
                      Qidirish
                    </button>
                  </div>

                  {/* Driver search results list */}
                  <div className="border border-slate-200 rounded-xl max-h-44 overflow-y-auto divide-y divide-slate-100 bg-white shadow-inner">
                    {modalDriverSearching ? (
                      <div className="p-4 text-center text-xs text-slate-500">Qidirilmoqda...</div>
                    ) : modalSearchedDrivers.length === 0 ? (
                      <div className="p-4 text-center text-xs text-slate-500">
                        {modalDriverSearch
                          ? "Mos keluvchi haydovchi topilmadi"
                          : "Haydovchini topish uchun ism yoki telefon kiriting"}
                      </div>
                    ) : (
                      modalSearchedDrivers.map((d) => (
                        <button
                          key={d.id}
                          type="button"
                          className="flex w-full items-center justify-between gap-3 p-3 text-left transition hover:bg-slate-50 focus:outline-none focus-visible:bg-brand-50"
                          onClick={() => setModalSelectedDriver(d)}
                        >
                          <span className="min-w-0">
                            <span className="block text-xs font-semibold text-slate-900">
                              {d.fullName}
                            </span>
                            <span className="block font-mono text-xs text-slate-500">
                              {formatUzPhone(d.phone)}{" "}
                              {d.vehicle
                                ? `· Hozirgi: ${formatUzPlate(d.vehicle.plateNumber)} (${d.vehicle.model})`
                                : "· Mashinasiz"}
                            </span>
                          </span>
                          <span className="shrink-0 text-xs font-semibold text-emerald-700">
                            Tanlash
                          </span>
                        </button>
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
                  className="input mb-1.5 w-full bg-slate-50 text-xs focus:bg-white"
                  placeholder="Avtomobilni qidirish (davlat raqami yoki model)..."
                  aria-label="Avtomobilni qidirish"
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
                  {modalSaving ? "Biriktirilmoqda..." : (
                    <>
                      <Icon name="check" className="h-4 w-4" />
                      Biriktirish
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
