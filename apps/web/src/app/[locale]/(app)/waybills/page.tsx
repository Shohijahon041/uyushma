"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { apiRequest } from "@/lib/client-api";
import { formatDate, useApi } from "@/lib/use-api";
import type { DriverItem, RouteItem, Vehicle, WaybillItem, WaybillStats } from "@/lib/types";
import { Alert, EmptyState, Loading, PageHeader, StatusBadge } from "@/components/ui";
import { formatUzPlate } from "@/lib/plate";
import { formatUzPhone } from "@/lib/phone";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function nowTimeString(): string {
  const d = new Date();
  return d.toTimeString().slice(0, 5);
}

export default function WaybillsPage() {
  const t = useTranslations("waybills");
  const tc = useTranslations("common");

  // Filter States
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [dateFilter, setDateFilter] = useState<string>("");

  // Data Fetching
  const queryUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    if (dateFilter) params.set("date", dateFilter);
    if (search.trim()) params.set("q", search.trim());
    const qs = params.toString();
    return qs ? `/waybills?${qs}` : "/waybills";
  }, [statusFilter, dateFilter, search]);

  const { data, loading, error, reload } = useApi<{ items: WaybillItem[]; total: number }>(queryUrl);
  const statsApi = useApi<WaybillStats>("/waybills/stats");
  const driversApi = useApi<{ items: DriverItem[] }>("/drivers?limit=200");
  const vehiclesApi = useApi<{ items: Vehicle[] }>("/vehicles?limit=200");
  const routesApi = useApi<{ items: RouteItem[] }>("/routes?limit=200");

  // Create Modal State
  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Form Fields
  const [formNumber, setFormNumber] = useState("");
  const [formDate, setFormDate] = useState(today());
  const [formDepartureTime, setFormDepartureTime] = useState(nowTimeString());
  const [formDriverId, setFormDriverId] = useState("");
  const [formVehicleId, setFormVehicleId] = useState("");
  const [formRouteId, setFormRouteId] = useState("");
  const [formStartOdometer, setFormStartOdometer] = useState<string>("");
  const [formFuelType, setFormFuelType] = useState("METAN");
  const [formFuelBefore, setFormFuelBefore] = useState("");
  const [formFuelGiven, setFormFuelGiven] = useState("");
  const [formMedicalPassed, setFormMedicalPassed] = useState(true);
  const [formDoctorName, setFormDoctorName] = useState("");
  const [formTechnicalPassed, setFormTechnicalPassed] = useState(true);
  const [formMechanicName, setFormMechanicName] = useState("");
  const [formDispatcherName, setFormDispatcherName] = useState("");
  const [formSpecialNotes, setFormSpecialNotes] = useState("");

  // Close Waybill Modal State
  const [closeTarget, setCloseTarget] = useState<WaybillItem | null>(null);
  const [closeOdometer, setCloseOdometer] = useState<string>("");
  const [closeReturnTime, setCloseReturnTime] = useState<string>(nowTimeString());
  const [closeFuelAfter, setCloseFuelAfter] = useState<string>("");
  const [closeNotes, setCloseNotes] = useState<string>("");
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);

  // Print / View Waybill Modal State
  const [printTarget, setPrintTarget] = useState<WaybillItem | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // When opening Create Modal, prefetch next number
  async function handleOpenCreate() {
    setFormError(null);
    setFormDate(today());
    setFormDepartureTime(nowTimeString());
    try {
      const res = await apiRequest<{ nextNumber: string }>("/waybills/next-number");
      setFormNumber(res.nextNumber);
    } catch {
      setFormNumber("");
    }

    if (driversApi.data?.items[0] && !formDriverId) {
      setFormDriverId(driversApi.data.items[0].id);
    }
    if (vehiclesApi.data?.items[0] && !formVehicleId) {
      setFormVehicleId(vehiclesApi.data.items[0].id);
    }
    setCreateOpen(true);
  }

  // When Vehicle is selected, automatically select driver if assigned
  function handleSelectVehicle(vehId: string) {
    setFormVehicleId(vehId);
    const found = vehiclesApi.data?.items.find((v) => v.id === vehId);
    if (found) {
      if (found.routeId && !formRouteId) {
        setFormRouteId(found.routeId);
      }
      const driverAssigned = found.assignments?.[0]?.driver?.id;
      if (driverAssigned) {
        setFormDriverId(driverAssigned);
      }
    }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!formDriverId || !formVehicleId) {
      setFormError("Haydovchi va avtomobilni tanlash majburiy");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const departureDateTime = new Date(`${formDate}T${formDepartureTime || "08:00"}:00`).toISOString();
      await apiRequest("/waybills", {
        method: "POST",
        body: {
          number: formNumber.trim() || undefined,
          date: formDate,
          driverId: formDriverId,
          vehicleId: formVehicleId,
          routeId: formRouteId || undefined,
          startOdometer: formStartOdometer ? parseInt(formStartOdometer, 10) : undefined,
          departureTime: departureDateTime,
          fuelType: formFuelType || undefined,
          fuelBefore: formFuelBefore ? parseFloat(formFuelBefore) : undefined,
          fuelGiven: formFuelGiven ? parseFloat(formFuelGiven) : undefined,
          medicalPassed: formMedicalPassed,
          medicalDoctorName: formDoctorName.trim() || undefined,
          technicalPassed: formTechnicalPassed,
          mechanicName: formMechanicName.trim() || undefined,
          dispatcherName: formDispatcherName.trim() || undefined,
          specialNotes: formSpecialNotes.trim() || undefined,
        },
      });
      setCreateOpen(false);
      await Promise.all([reload(), statsApi.reload()]);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : tc("error"));
    } finally {
      setSaving(false);
    }
  }

  // Handle Closing Waybill
  function openCloseModal(waybill: WaybillItem) {
    setCloseTarget(waybill);
    setCloseOdometer(waybill.startOdometer ? String(waybill.startOdometer + 50) : "");
    setCloseReturnTime(nowTimeString());
    setCloseFuelAfter(waybill.fuelBefore ?? "");
    setCloseNotes("");
    setCloseError(null);
  }

  async function handleCloseWaybill(e: FormEvent) {
    e.preventDefault();
    if (!closeTarget) return;
    const endKm = parseInt(closeOdometer, 10);
    if (isNaN(endKm) || endKm < 0) {
      setCloseError("Qaytishdagi spidometr ko'rsatkichini to'g'ri kiriting");
      return;
    }
    if (closeTarget.startOdometer !== null && endKm < closeTarget.startOdometer) {
      setCloseError(`Qaytish spidometri chiqishdagidan (${closeTarget.startOdometer} km) kam bo'lishi mumkin emas`);
      return;
    }

    setClosing(true);
    setCloseError(null);
    try {
      const returnDateTime = new Date(`${today()}T${closeReturnTime || "18:00"}:00`).toISOString();
      await apiRequest(`/waybills/${closeTarget.id}/close`, {
        method: "POST",
        body: {
          endOdometer: endKm,
          returnTime: returnDateTime,
          fuelAfter: closeFuelAfter ? parseFloat(closeFuelAfter) : undefined,
          specialNotes: closeNotes.trim() || undefined,
        },
      });
      setCloseTarget(null);
      await Promise.all([reload(), statsApi.reload()]);
    } catch (err) {
      setCloseError(err instanceof Error ? err.message : tc("error"));
    } finally {
      setClosing(false);
    }
  }

  // Handle Cancel
  async function handleCancelWaybill(waybill: WaybillItem) {
    const reason = window.prompt("Ushbu yo'l varaqasini bekor qilish sababini kiriting:");
    if (reason === null) return;
    try {
      await apiRequest(`/waybills/${waybill.id}/cancel`, {
        method: "POST",
        body: { reason: reason.trim() || "Dispetcher tomonidan bekor qilindi" },
      });
      await Promise.all([reload(), statsApi.reload()]);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : tc("error"));
    }
  }

  const items = data?.items ?? [];
  const stats = statsApi.data ?? {
    total: 0,
    active: 0,
    completedToday: 0,
    compliantChecksRate: 100,
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        action={
          <button
            type="button"
            onClick={handleOpenCreate}
            className="btn btn-primary flex items-center gap-2"
          >
            <span>+</span>
            <span>{t("newWaybill")}</span>
          </button>
        }
      />

      {actionError && (
        <Alert tone="error">
          <div className="flex items-center justify-between">
            <span>{actionError}</span>
            <button
              type="button"
              onClick={() => setActionError(null)}
              className="text-xs font-bold underline"
            >
              {tc("close")}
            </button>
          </div>
        </Alert>
      )}

      {/* KPI Stats Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="card p-4">
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">
            {t("total")}
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900">{stats.total}</div>
        </div>

        <div className="card p-4 border-l-4 border-l-emerald-500">
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">
            {t("active")}
          </div>
          <div className="mt-2 text-2xl font-bold text-emerald-600">{stats.active}</div>
        </div>

        <div className="card p-4 border-l-4 border-l-blue-500">
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">
            {t("completedToday")}
          </div>
          <div className="mt-2 text-2xl font-bold text-blue-600">{stats.completedToday}</div>
        </div>

        <div className="card p-4 border-l-4 border-l-violet-500">
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">
            {t("compliantRate")}
          </div>
          <div className="mt-2 text-2xl font-bold text-violet-600">
            {stats.compliantChecksRate}%
          </div>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="card p-4 flex flex-col sm:flex-row items-center gap-3">
        <div className="flex-1 w-full">
          <input
            type="text"
            className="input w-full"
            placeholder={t("searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="w-full sm:w-48">
          <select
            className="input w-full"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">{t("allStatuses")}</option>
            <option value="ACTIVE">{t("statusActive")}</option>
            <option value="ISSUED">{t("statusIssued")}</option>
            <option value="COMPLETED">{t("statusCompleted")}</option>
            <option value="CANCELLED">{t("statusCancelled")}</option>
          </select>
        </div>

        <div className="w-full sm:w-44">
          <input
            type="date"
            className="input w-full"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
          />
        </div>

        {dateFilter && (
          <button
            type="button"
            onClick={() => setDateFilter("")}
            className="text-xs text-slate-500 hover:text-slate-800 underline whitespace-nowrap"
          >
            Sanani tozalash
          </button>
        )}
      </div>

      {/* Waybills Table */}
      {loading ? (
        <Loading />
      ) : error ? (
        <Alert tone="error">{error}</Alert>
      ) : items.length === 0 ? (
        <EmptyState>
          <div className="text-base font-semibold text-slate-700">{t("empty")}</div>
          <p className="mt-1 text-slate-500 max-w-sm mx-auto">
            Hozircha hech qanday yo&apos;l varaqasi topilmadi. Yangi yo&apos;l varaqasini rasmiylashtirish uchun yuqoridagi tugmani bosing.
          </p>
        </EmptyState>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>{t("number")}</th>
                <th>{t("driver")}</th>
                <th>{t("vehicle")}</th>
                <th>{t("route")}</th>
                <th>{t("date")}</th>
                <th>{t("checks")}</th>
                <th>{t("odometer")}</th>
                <th>{t("status")}</th>
                <th className="text-right">{t("actions")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((waybill) => {
                const isWaybillActive = waybill.status === "ACTIVE" || waybill.status === "ISSUED";
                return (
                  <tr key={waybill.id} className="hover:bg-slate-50/60 transition-colors">
                    {/* Number */}
                    <td>
                      <div className="font-mono font-bold text-slate-900 flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                        {waybill.number}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {waybill.date ? waybill.date.slice(0, 10) : ""}
                      </div>
                    </td>

                    {/* Driver */}
                    <td>
                      <div className="font-semibold text-slate-900">
                        {waybill.driver.fullName}
                      </div>
                      <div className="text-xs text-slate-500 font-mono">
                        {formatUzPhone(waybill.driver.phone)}
                      </div>
                    </td>

                    {/* Vehicle */}
                    <td>
                      <div className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 border border-slate-300 rounded font-mono font-bold text-xs text-slate-800">
                        {formatUzPlate(waybill.vehicle.plateNumber)}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {waybill.vehicle.model}
                      </div>
                    </td>

                    {/* Route */}
                    <td>
                      <div className="text-sm font-medium text-slate-800">
                        {waybill.route ? waybill.route.name : "Erkin yo'nalish"}
                      </div>
                      {waybill.route?.distanceKm && (
                        <div className="text-xs text-slate-400">
                          {waybill.route.distanceKm} km
                        </div>
                      )}
                    </td>

                    {/* Date and Time */}
                    <td>
                      <div className="text-xs text-slate-700">
                        Chiqish:{" "}
                        <span className="font-semibold">
                          {waybill.departureTime
                            ? new Date(waybill.departureTime).toLocaleTimeString("uz-UZ", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })
                            : "-"}
                        </span>
                      </div>
                      {waybill.returnTime && (
                        <div className="text-xs text-slate-500">
                          Qaytish:{" "}
                          <span className="font-semibold">
                            {new Date(waybill.returnTime).toLocaleTimeString("uz-UZ", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </div>
                      )}
                    </td>

                    {/* Inspections */}
                    <td>
                      <div className="flex flex-col gap-1">
                        <span
                          className={`badge text-[10px] ${
                            waybill.medicalPassed
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-red-50 text-red-700"
                          }`}
                        >
                          {waybill.medicalPassed ? "🩺 Shifokor: OK" : "🩺 Shifokor: Rad"}
                        </span>
                        <span
                          className={`badge text-[10px] ${
                            waybill.technicalPassed
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-red-50 text-red-700"
                          }`}
                        >
                          {waybill.technicalPassed ? "🔧 Mexanik: OK" : "🔧 Mexanik: Rad"}
                        </span>
                      </div>
                    </td>

                    {/* Odometer */}
                    <td>
                      <div className="text-xs font-mono text-slate-700">
                        {waybill.startOdometer !== null ? `${waybill.startOdometer} km` : "-"}
                        {waybill.endOdometer !== null && ` → ${waybill.endOdometer} km`}
                      </div>
                      {waybill.distanceKm !== null && (
                        <div className="text-xs font-bold text-emerald-600">
                          {waybill.distanceKm} km bosib o&apos;tdi
                        </div>
                      )}
                    </td>

                    {/* Status */}
                    <td>
                      <StatusBadge
                        status={waybill.status}
                        label={
                          waybill.status === "ACTIVE"
                            ? t("statusActive")
                            : waybill.status === "ISSUED"
                              ? t("statusIssued")
                              : waybill.status === "COMPLETED"
                                ? t("statusCompleted")
                                : t("statusCancelled")
                        }
                      />
                    </td>

                    {/* Actions */}
                    <td className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {/* Print / View */}
                        <button
                          type="button"
                          onClick={() => setPrintTarget(waybill)}
                          title={t("print")}
                          className="px-2.5 py-1 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition"
                        >
                          🖨️ Chop etish
                        </button>

                        {/* Complete / Close */}
                        {isWaybillActive && (
                          <button
                            type="button"
                            onClick={() => openCloseModal(waybill)}
                            title={t("close")}
                            className="px-2.5 py-1 text-xs font-semibold bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg transition"
                          >
                            🏁 Yakunlash
                          </button>
                        )}

                        {/* Cancel */}
                        {isWaybillActive && (
                          <button
                            type="button"
                            onClick={() => handleCancelWaybill(waybill)}
                            title={t("cancel")}
                            className="px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded-lg transition"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 1: YANGI YO'L VARAQASI RASMIYLASHTIRISH                         */}
      {/* ===================================================================== */}
      {createOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full p-6 space-y-5 my-8 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b pb-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900">{t("createTitle")}</h3>
                <p className="text-xs text-slate-500">
                  Haydovchi, avtomobil va ko&apos;rik xulosalarini kiriting
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold p-1"
              >
                ✕
              </button>
            </div>

            {formError && <Alert tone="error">{formError}</Alert>}

            <form onSubmit={handleCreate} className="space-y-4">
              {/* Row 1: Number and Date */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Yo&apos;l varaqasi raqami
                  </label>
                  <input
                    type="text"
                    required
                    className="input w-full font-mono font-bold"
                    value={formNumber}
                    onChange={(e) => setFormNumber(e.target.value)}
                    placeholder="PV-26-0001"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {t("date")}
                  </label>
                  <input
                    type="date"
                    required
                    className="input w-full"
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {t("departureTime")}
                  </label>
                  <input
                    type="time"
                    required
                    className="input w-full"
                    value={formDepartureTime}
                    onChange={(e) => setFormDepartureTime(e.target.value)}
                  />
                </div>
              </div>

              {/* Row 2: Vehicle & Driver Selection */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {t("selectVehicle")} *
                  </label>
                  <select
                    required
                    className="input w-full"
                    value={formVehicleId}
                    onChange={(e) => handleSelectVehicle(e.target.value)}
                  >
                    <option value="">Tanlang...</option>
                    {vehiclesApi.data?.items.map((veh) => (
                      <option key={veh.id} value={veh.id}>
                        {formatUzPlate(veh.plateNumber)} — {veh.model}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {t("selectDriver")} *
                  </label>
                  <select
                    required
                    className="input w-full"
                    value={formDriverId}
                    onChange={(e) => setFormDriverId(e.target.value)}
                  >
                    <option value="">Tanlang...</option>
                    {driversApi.data?.items.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.fullName} ({formatUzPhone(d.phone)})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Row 3: Route & Start Odometer */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {t("selectRoute")}
                  </label>
                  <select
                    className="input w-full"
                    value={formRouteId}
                    onChange={(e) => setFormRouteId(e.target.value)}
                  >
                    <option value="">Erkin yo&apos;nalish (shahar bo&apos;ylab)</option>
                    {routesApi.data?.items.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name} ({r.origin} → {r.destination})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {t("startKm")}
                  </label>
                  <input
                    type="number"
                    min="0"
                    className="input w-full font-mono"
                    placeholder="Masalan: 124500"
                    value={formStartOdometer}
                    onChange={(e) => setFormStartOdometer(e.target.value)}
                  />
                </div>
              </div>

              {/* Row 4: Medical & Technical Check */}
              <div className="p-3 bg-slate-50 border rounded-xl space-y-3">
                <div className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                  Tibbiy va Texnik ko&apos;rik
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Medical */}
                  <div className="p-2.5 bg-white border rounded-lg space-y-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formMedicalPassed}
                        onChange={(e) => setFormMedicalPassed(e.target.checked)}
                        className="rounded text-emerald-600 focus:ring-emerald-500 h-4 w-4"
                      />
                      <span className="text-xs font-bold text-slate-800">
                        🩺 Tibbiy ko&apos;rikdan o&apos;tdi
                      </span>
                    </label>
                    <input
                      type="text"
                      className="input w-full text-xs"
                      placeholder={t("doctorName")}
                      value={formDoctorName}
                      onChange={(e) => setFormDoctorName(e.target.value)}
                    />
                  </div>

                  {/* Technical */}
                  <div className="p-2.5 bg-white border rounded-lg space-y-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formTechnicalPassed}
                        onChange={(e) => setFormTechnicalPassed(e.target.checked)}
                        className="rounded text-emerald-600 focus:ring-emerald-500 h-4 w-4"
                      />
                      <span className="text-xs font-bold text-slate-800">
                        🔧 Texnik soz, ruxsat berildi
                      </span>
                    </label>
                    <input
                      type="text"
                      className="input w-full text-xs"
                      placeholder={t("mechanicName")}
                      value={formMechanicName}
                      onChange={(e) => setFormMechanicName(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* Row 5: Fuel & Dispatcher */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {t("fuelType")}
                  </label>
                  <select
                    className="input w-full"
                    value={formFuelType}
                    onChange={(e) => setFormFuelType(e.target.value)}
                  >
                    <option value="METAN">METAN (m³)</option>
                    <option value="PROPAN">PROPAN (L)</option>
                    <option value="BENZIN_80">BENZIN AI-80 (L)</option>
                    <option value="BENZIN_92">BENZIN AI-92 (L)</option>
                    <option value="DIZEL">DIZEL (L)</option>
                    <option value="ELEKTR">ELEKTR (kVt)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {t("fuelBefore")}
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    className="input w-full"
                    placeholder="Qoldiq hajm"
                    value={formFuelBefore}
                    onChange={(e) => setFormFuelBefore(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {t("dispatcherName")}
                  </label>
                  <input
                    type="text"
                    className="input w-full"
                    placeholder="Mas'ul shaxs"
                    value={formDispatcherName}
                    onChange={(e) => setFormDispatcherName(e.target.value)}
                  />
                </div>
              </div>

              {/* Special notes */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {t("notes")}
                </label>
                <textarea
                  className="input w-full h-16 text-xs"
                  placeholder="Alohida ko'rsatmalar, yuk yoki yo'lovchilar bo'yicha eslatmalar..."
                  value={formSpecialNotes}
                  onChange={(e) => setFormSpecialNotes(e.target.value)}
                />
              </div>

              {/* Modal Actions */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="btn btn-secondary"
                  disabled={saving}
                >
                  {tc("cancel")}
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="btn btn-primary"
                >
                  {saving ? t("creating") : t("create")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 2: PUTYOVKANI YAKUNLASH (RETURN ODOMETER & FUEL)               */}
      {/* ===================================================================== */}
      {closeTarget && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="text-lg font-bold text-slate-900">{t("closeTitle")}</h3>
                <p className="text-xs text-slate-500">
                  {closeTarget.number} &bull; {closeTarget.driver.fullName} &bull; {formatUzPlate(closeTarget.vehicle.plateNumber)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCloseTarget(null)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold p-1"
              >
                ✕
              </button>
            </div>

            {closeError && <Alert tone="error">{closeError}</Alert>}

            <form onSubmit={handleCloseWaybill} className="space-y-4">
              <div className="p-3 bg-slate-50 border rounded-xl text-xs space-y-1">
                <div>
                  Chiqish spidometri:{" "}
                  <span className="font-mono font-bold text-slate-800">
                    {closeTarget.startOdometer !== null ? `${closeTarget.startOdometer} km` : "Qayd etilmagan"}
                  </span>
                </div>
                {closeOdometer && closeTarget.startOdometer !== null && parseInt(closeOdometer, 10) >= closeTarget.startOdometer && (
                  <div className="text-emerald-700 font-bold">
                    Bosib o&apos;tiladigan masofa: {parseInt(closeOdometer, 10) - closeTarget.startOdometer} km
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {t("returnKm")} *
                </label>
                <input
                  type="number"
                  required
                  min={closeTarget.startOdometer ?? 0}
                  className="input w-full font-mono text-base font-bold"
                  value={closeOdometer}
                  onChange={(e) => setCloseOdometer(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {t("returnTime")}
                  </label>
                  <input
                    type="time"
                    required
                    className="input w-full"
                    value={closeReturnTime}
                    onChange={(e) => setCloseReturnTime(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {t("fuelAfter")}
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    className="input w-full"
                    placeholder="Qolgan yoqilg'i"
                    value={closeFuelAfter}
                    onChange={(e) => setCloseFuelAfter(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {t("notes")}
                </label>
                <textarea
                  className="input w-full h-16 text-xs"
                  placeholder="Reys davomidagi holatlar, nosozliklar yoki eslatmalar..."
                  value={closeNotes}
                  onChange={(e) => setCloseNotes(e.target.value)}
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t">
                <button
                  type="button"
                  onClick={() => setCloseTarget(null)}
                  className="btn btn-secondary"
                  disabled={closing}
                >
                  {tc("cancel")}
                </button>
                <button
                  type="submit"
                  disabled={closing}
                  className="btn btn-primary"
                >
                  {closing ? t("closing") : t("finish")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 3: RASMIY YO'L VARAQASI (CHOP ETISH UCHUN BLANKA A4/A5)          */}
      {/* ===================================================================== */}
      {printTarget && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full p-4 sm:p-8 space-y-6 my-6 max-h-[95vh] overflow-y-auto print:max-w-none print:w-full print:p-0 print:m-0 print:shadow-none">
            {/* Modal action bar (hidden during print) */}
            <div className="flex items-center justify-between border-b pb-3 print:hidden">
              <div className="text-sm font-bold text-slate-700">
                Yo&apos;l varaqasi &bull; {printTarget.number}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="btn btn-primary text-xs flex items-center gap-1.5"
                >
                  🖨️ Chop etish (Print)
                </button>
                <button
                  type="button"
                  onClick={() => setPrintTarget(null)}
                  className="btn btn-secondary text-xs"
                >
                  {tc("close")}
                </button>
              </div>
            </div>

            {/* Printable Document Sheet (Standard Uzbekistan Waybill Form) */}
            <div className="border border-slate-900 p-5 space-y-4 text-slate-900 bg-white font-sans text-xs">
              {/* Header: Title and Reg Number */}
              <div className="flex justify-between items-start border-b-2 border-slate-900 pb-3">
                <div>
                  <div className="text-[10px] uppercase font-bold tracking-wider text-slate-500">
                    O&apos;zbekiston Respublikasi Transport Vazirligi
                  </div>
                  <h2 className="text-lg font-extrabold uppercase tracking-tight mt-0.5">
                    YO&apos;L VARAQASI (ПУТЕВОЙ ЛИСТ)
                  </h2>
                  <div className="font-mono font-bold text-base text-slate-800">
                    № {printTarget.number}
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-xs font-semibold text-slate-600">
                    Tashkilot:
                  </div>
                  <div className="text-sm font-bold">
                    {printTarget.company?.name ?? "Transport Korxonasi"}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    Sana: <b>{printTarget.date.slice(0, 10)}</b> &bull; Amal qiladi: <b>{printTarget.validUntil.slice(0, 10)}</b>
                  </div>
                </div>
              </div>

              {/* Vehicle and Driver info grid */}
              <div className="grid grid-cols-2 gap-3 border-b pb-3">
                <div className="space-y-1">
                  <div>
                    Avtomobil: <span className="font-bold">{printTarget.vehicle.model}</span>
                  </div>
                  <div>
                    Davlat raqami:{" "}
                    <span className="font-mono font-bold px-1.5 py-0.5 border border-black rounded">
                      {formatUzPlate(printTarget.vehicle.plateNumber)}
                    </span>
                  </div>
                  <div>
                    Yo&apos;nalish:{" "}
                    <span className="font-semibold">
                      {printTarget.route ? `${printTarget.route.name} (${printTarget.route.origin} → ${printTarget.route.destination})` : "Erkin reys"}
                    </span>
                  </div>
                </div>

                <div className="space-y-1">
                  <div>
                    Haydovchi: <span className="font-bold">{printTarget.driver.fullName}</span>
                  </div>
                  <div>
                    Guvohnoma:{" "}
                    <span className="font-mono">
                      {printTarget.driver.licenseNumber ?? "Mavjud"}
                    </span>
                  </div>
                  <div>
                    Aloqa telefoni:{" "}
                    <span className="font-mono">
                      {formatUzPhone(printTarget.driver.phone)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Departure and Return Metrics Table */}
              <table className="w-full border-collapse border border-slate-900 text-center text-xs">
                <thead>
                  <tr className="bg-slate-100 font-bold border-b border-slate-900">
                    <th className="border border-slate-900 p-1.5">Ko&apos;rsatkich</th>
                    <th className="border border-slate-900 p-1.5">Chiqishda (Jo&apos;nash)</th>
                    <th className="border border-slate-900 p-1.5">Qaytishda (Garajga kirish)</th>
                    <th className="border border-slate-900 p-1.5">Farq / Jami</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="border border-slate-900 p-1.5 font-semibold text-left">Vaqt</td>
                    <td className="border border-slate-900 p-1.5 font-mono">
                      {printTarget.departureTime
                        ? new Date(printTarget.departureTime).toLocaleTimeString("uz-UZ", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "08:00"}
                    </td>
                    <td className="border border-slate-900 p-1.5 font-mono">
                      {printTarget.returnTime
                        ? new Date(printTarget.returnTime).toLocaleTimeString("uz-UZ", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "-"}
                    </td>
                    <td className="border border-slate-900 p-1.5">-</td>
                  </tr>
                  <tr>
                    <td className="border border-slate-900 p-1.5 font-semibold text-left">
                      Spidometr (km)
                    </td>
                    <td className="border border-slate-900 p-1.5 font-mono font-bold">
                      {printTarget.startOdometer !== null ? printTarget.startOdometer : "-"}
                    </td>
                    <td className="border border-slate-900 p-1.5 font-mono font-bold">
                      {printTarget.endOdometer !== null ? printTarget.endOdometer : "-"}
                    </td>
                    <td className="border border-slate-900 p-1.5 font-mono font-bold text-emerald-800">
                      {printTarget.distanceKm !== null ? `${printTarget.distanceKm} km` : "-"}
                    </td>
                  </tr>
                  <tr>
                    <td className="border border-slate-900 p-1.5 font-semibold text-left">
                      Yoqilg&apos;i ({printTarget.fuelType ?? "METAN"})
                    </td>
                    <td className="border border-slate-900 p-1.5 font-mono">
                      {printTarget.fuelBefore ?? "-"}
                    </td>
                    <td className="border border-slate-900 p-1.5 font-mono">
                      {printTarget.fuelAfter ?? "-"}
                    </td>
                    <td className="border border-slate-900 p-1.5 font-mono">
                      Berilgan: {printTarget.fuelGiven ?? "0"}
                    </td>
                  </tr>
                </tbody>
              </table>

              {/* Stamps and Signatures (Medical & Technical Inspection) */}
              <div className="grid grid-cols-2 gap-4 pt-2">
                {/* Medical Stamp Block */}
                <div className="border border-slate-900 p-3 rounded space-y-2">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-center border-b pb-1">
                    Tibbiy Ko&apos;rik Xulosasi
                  </div>
                  <div className="text-[11px] leading-tight">
                    Haydovchi safar oldi tibbiy ko&apos;rigidan o&apos;tkazildi. Spirtli ichimliklar va giyohvand moddalar ta&apos;siri aniqlanmadi.
                  </div>
                  <div className="pt-2 flex items-center justify-between text-[11px]">
                    <div>
                      Holati: <b>{printTarget.medicalPassed ? "✅ Sog'lom / Ruxsat" : "❌ Ruxsat berilmadi"}</b>
                      <div className="text-[10px] text-slate-600">
                        Shifokor: {printTarget.medicalDoctorName ?? "Tibbiyot xodimi"}
                      </div>
                    </div>
                    <div className="w-16 h-12 border border-dashed border-slate-400 flex items-center justify-center text-[9px] text-slate-400 uppercase">
                      [Muhr/Imzo]
                    </div>
                  </div>
                </div>

                {/* Technical Stamp Block */}
                <div className="border border-slate-900 p-3 rounded space-y-2">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-center border-b pb-1">
                    Texnik Ko&apos;rik Xulosasi
                  </div>
                  <div className="text-[11px] leading-tight">
                    Avtomobilning tormoz, rul boshqaruvi, chiroqlar va xavfsizlik tizimlari tekshirildi, texnik soz holatda.
                  </div>
                  <div className="pt-2 flex items-center justify-between text-[11px]">
                    <div>
                      Holati: <b>{printTarget.technicalPassed ? "✅ Soz / Chiqishga ruxsat" : "❌ Nosoz"}</b>
                      <div className="text-[10px] text-slate-600">
                        Mexanik: {printTarget.mechanicName ?? "Mas'ul mexanik"}
                      </div>
                    </div>
                    <div className="w-16 h-12 border border-dashed border-slate-400 flex items-center justify-center text-[9px] text-slate-400 uppercase">
                      [Muhr/Imzo]
                    </div>
                  </div>
                </div>
              </div>

              {/* Bottom Verification Section with QR Code */}
              <div className="border-t-2 border-slate-900 pt-3 flex items-center justify-between">
                <div className="space-y-1 text-[11px]">
                  <div>
                    Dispetcher (Mas&apos;ul shaxs):{" "}
                    <b>{printTarget.dispatcherName ?? "Navbatchi dispetcher"}</b> (imzo: _________)
                  </div>
                  <div className="text-[10px] text-slate-500">
                    Elektron tekshiruv: YPX va Transport Nazorati inspektorlari o&apos;ng tarafdagi QR kod orqali haqiqiylikni tekshirishi shart.
                  </div>
                  <div className="text-[9px] font-mono text-slate-400">
                    Token: {printTarget.publicToken}
                  </div>
                </div>

                {/* QR Code image */}
                <div className="p-1 border border-slate-900 rounded bg-white">
                  <img
                    src={`/api/v1/waybills/public-verify/${printTarget.publicToken}/qr`}
                    alt="QR Tekshiruv"
                    width={80}
                    height={80}
                    className="w-20 h-20"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
