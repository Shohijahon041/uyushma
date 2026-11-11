"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { apiRequest } from "@/lib/client-api";
import { formatDate, formatMoney, useApi } from "@/lib/use-api";
import type { DriverItem, RouteItem, Vehicle } from "@/lib/types";
import { Alert, EmptyState, Loading, PageHeader, StatusBadge } from "@/components/ui";
import { RoutePlanInput, normalizeMoneyInput } from "@/components/route-plan-input";
import { formatUzPlate } from "@/lib/plate";
import { formatUzPhone } from "@/lib/phone";

interface Owner {
  id: string;
  fullName: string;
  role: string;
}

function MonthlyFeeCell({
  vehicle,
  onSaved,
}: {
  vehicle: Vehicle;
  onSaved: () => Promise<void>;
}) {
  const t = useTranslations("vehicles");
  const tc = useTranslations("common");
  const [value, setValue] = useState(vehicle.monthlyFee);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setValue(vehicle.monthlyFee), [vehicle.monthlyFee]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await apiRequest(`/vehicles/${vehicle.id}`, {
        method: "PATCH",
        body: { monthlyFee: normalizeMoneyInput(value) || "0" },
      });
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : tc("error"));
    } finally {
      setSaving(false);
    }
  }

  const inheritsRoute =
    Number(vehicle.monthlyFee) === 0 && vehicle.route && Number(vehicle.route.monthlyPlan) > 0;

  return (
    <div className="flex flex-col gap-1">
      <input
        className="input w-32 px-2 py-1 text-xs"
        inputMode="decimal"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        aria-label={tc("amount")}
      />
      {inheritsRoute && (
        <span className="text-[10px] text-sky-700">
          {t("fromRoute", { amount: formatMoney(vehicle.route!.monthlyPlan) })}
        </span>
      )}
      <button
        type="button"
        className="btn-ghost px-1 py-0.5 text-[11px]"
        onClick={() => void save()}
        disabled={saving || Number(normalizeMoneyInput(value) || "0") === Number(vehicle.monthlyFee)}
      >
        {saving ? tc("loading") : tc("save")}
      </button>
      {error && <span className="text-[10px] text-red-600">{error}</span>}
    </div>
  );
}

function RouteCell({
  vehicle,
  routes,
  onSaved,
}: {
  vehicle: Vehicle;
  routes: RouteItem[];
  onSaved: () => Promise<void>;
}) {
  const t = useTranslations("vehicles");
  const tc = useTranslations("common");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const external = vehicle.externalVehicles[0];

  async function change(routeId: string) {
    setSaving(true);
    setError(null);
    try {
      await apiRequest(`/vehicles/${vehicle.id}`, {
        method: "PATCH",
        body: { routeId: routeId || null },
      });
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : tc("error"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <select
        className="select w-44 px-2 py-1 text-xs"
        value={vehicle.routeId ?? ""}
        onChange={(event) => void change(event.target.value)}
        disabled={saving}
        aria-label={t("route")}
      >
        <option value="">{t("noRoute")}</option>
        {routes
          .filter((route) => route.isActive || route.id === vehicle.routeId)
          .map((route) => (
            <option key={route.id} value={route.id}>
              {route.name}
            </option>
          ))}
      </select>
      {external?.routeNumber && (
        <span className="text-[10px] text-slate-400">№ {external.routeNumber}</span>
      )}
      {error && <span className="text-[10px] text-red-600">{error}</span>}
    </div>
  );
}

interface VehicleGroup {
  key: string;
  route: RouteItem | null;
  name: string;
  items: Vehicle[];
}

export default function VehiclesPage() {
  const t = useTranslations("vehicles");
  const tc = useTranslations("common");
  const { data, loading, error, reload } = useApi<{ items: Vehicle[] }>(
    "/vehicles?includeInactive=true",
  );
  const owners = useApi<{ items: Owner[] }>("/users/owners");
  const routes = useApi<{ items: RouteItem[] }>("/routes");

  const [search, setSearch] = useState("");
  const [routeFilter, setRouteFilter] = useState("");
  const [grouped, setGrouped] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);

  const [ownerId, setOwnerId] = useState("");
  const [plateNumber, setPlateNumber] = useState("");
  const [model, setModel] = useState("");
  const [capacity, setCapacity] = useState("20");
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Driver Assignment State
  const [assignVehicle, setAssignVehicle] = useState<Vehicle | null>(null);
  const [driverSearch, setDriverSearch] = useState("");
  const [driverSearching, setDriverSearching] = useState(false);
  const [searchedDrivers, setSearchedDrivers] = useState<DriverItem[]>([]);
  const [selectedDriver, setSelectedDriver] = useState<DriverItem | null>(null);
  const [assignDate, setAssignDate] = useState(new Date().toISOString().slice(0, 10));
  const [assignAmount, setAssignAmount] = useState("");
  const [assignSaving, setAssignSaving] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);

  async function searchDrivers(query: string) {
    setDriverSearching(true);
    try {
      const q = query.trim();
      const res = await apiRequest<{ items: DriverItem[] }>(
        q ? `/drivers?q=${encodeURIComponent(q)}` : "/drivers",
      );
      setSearchedDrivers(res.items || []);
    } catch {
      setSearchedDrivers([]);
    } finally {
      setDriverSearching(false);
    }
  }

  function openAssignModal(vehicle: Vehicle) {
    setAssignVehicle(vehicle);
    setSelectedDriver(null);
    setDriverSearch("");
    setAssignDate(new Date().toISOString().slice(0, 10));
    setAssignAmount(vehicle.monthlyFee || "");
    setAssignError(null);
    void searchDrivers("");
  }

  function triggerDriverSearch() {
    void searchDrivers(driverSearch);
  }

  useEffect(() => {
    if (!assignVehicle) return;
    const timer = setTimeout(() => {
      void searchDrivers(driverSearch);
    }, 250);
    return () => clearTimeout(timer);
  }, [driverSearch, assignVehicle]);

  async function handleAssignSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!assignVehicle || !selectedDriver) return;
    setAssignSaving(true);
    setAssignError(null);
    try {
      await apiRequest(`/drivers/${selectedDriver.id}/assign`, {
        method: "POST",
        body: {
          vehicleId: assignVehicle.id,
          startDate: assignDate || new Date().toISOString().slice(0, 10),
          ...(assignAmount.trim() ? { monthlyAmount: assignAmount.trim() } : {}),
        },
      });
      setNotice(
        `${selectedDriver.fullName} muvaffaqiyatli ${formatUzPlate(assignVehicle.plateNumber)} avtomobiliga biriktirildi!`,
      );
      setAssignVehicle(null);
      await reload();
    } catch (err) {
      setAssignError(err instanceof Error ? err.message : tc("error"));
    } finally {
      setAssignSaving(false);
    }
  }

  useEffect(() => {
    if (!ownerId && owners.data?.items[0]) {
      setOwnerId(owners.data.items[0].id);
    }
  }, [ownerId, owners.data]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setSaving(true);
    try {
      await apiRequest<Vehicle>("/vehicles", {
        method: "POST",
        body: {
          ownerId,
          plateNumber,
          model,
          capacity: Number(capacity),
        },
      });
      setPlateNumber("");
      setModel("");
      setCapacity("20");
      await reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : tc("error"));
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(vehicle: Vehicle, status: "ACTIVE" | "MAINTENANCE" | "INACTIVE") {
    setActionError(null);
    try {
      await apiRequest(`/vehicles/${vehicle.id}`, {
        method: "PATCH",
        body: { status },
      });
      await reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : tc("error"));
    }
  }

  const routeItems = useMemo(() => routes.data?.items ?? [], [routes.data]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (data?.items ?? []).filter((vehicle) => {
      if (routeFilter === "none" && vehicle.routeId) return false;
      if (routeFilter && routeFilter !== "none" && vehicle.routeId !== routeFilter) return false;
      if (!query) return true;
      const driver = vehicle.assignments[0]?.driver;
      return [
        vehicle.plateNumber,
        vehicle.model,
        vehicle.route?.name,
        driver?.fullName,
        driver?.phone,
        vehicle.externalVehicles[0]?.garageNumber,
      ].some((value) => value?.toLowerCase().includes(query));
    });
  }, [data, search, routeFilter]);

  const [page, setPage] = useState(1);
  const pageSize = 50;

  useEffect(() => {
    setPage(1);
  }, [search, routeFilter, grouped]);

  const groups = useMemo<VehicleGroup[]>(() => {
    if (!grouped) {
      const start = (page - 1) * pageSize;
      const paginated = filtered.slice(start, start + pageSize);
      return [{ key: "all", route: null, name: "", items: paginated }];
    }
    const byRoute = new Map<string, VehicleGroup>();
    for (const vehicle of filtered) {
      const key = vehicle.routeId ?? "none";
      let group = byRoute.get(key);
      if (!group) {
        group = {
          key,
          route: routeItems.find((route) => route.id === vehicle.routeId) ?? null,
          name: vehicle.route?.name ?? t("noRoute"),
          items: [],
        };
        byRoute.set(key, group);
      }
      group.items.push(vehicle);
    }
    return Array.from(byRoute.values()).sort((a, b) => {
      if (a.key === "none") return 1;
      if (b.key === "none") return -1;
      return a.name.localeCompare(b.name, "uz");
    });
  }, [filtered, grouped, routeItems, t, page, pageSize]);

  function toggleGroup(key: string) {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function onPlanSaved(affectedPlans: number) {
    setNotice(t("planSaved", { count: affectedPlans }));
    await Promise.all([reload(), routes.reload()]);
  }

  const columnCount = 11;

  function vehicleRow(vehicle: Vehicle) {
    const external = vehicle.externalVehicles[0];
    return (
      <tr key={vehicle.id}>
        <td className="font-mono font-semibold text-slate-900">
          {formatUzPlate(vehicle.plateNumber)}
          {external && (
            <p className="text-[10px] font-normal uppercase tracking-wide text-slate-400">
              {external.provider === "ETENDER" ? "e-tender" : "autopark"}
            </p>
          )}
        </td>
        <td>
          <p>{vehicle.model}</p>
          {external?.garageNumber && (
            <p className="text-[11px] text-slate-400">
              {t("garage")}: {external.garageNumber}
            </p>
          )}
        </td>
        <td>
          <RouteCell vehicle={vehicle} routes={routeItems} onSaved={reload} />
        </td>
        <td>{vehicle.owner.fullName}</td>
        <td className="text-xs">
          {vehicle.assignments[0] ? (
            <>
              <p className="font-medium text-slate-800">{vehicle.assignments[0].driver.fullName}</p>
              <p className="font-mono text-[11px] text-slate-400">
                {formatUzPhone(vehicle.assignments[0].driver.phone)}
              </p>
              <button
                type="button"
                onClick={() => openAssignModal(vehicle)}
                className="mt-1 text-[10.5px] text-blue-600 hover:text-blue-800 underline font-medium block"
              >
                ⇄ Almashtirish
              </button>
            </>
          ) : (
            <>
              <span className="text-slate-400 block">{t("noDriver")}</span>
              <button
                type="button"
                onClick={() => openAssignModal(vehicle)}
                className="mt-1 inline-flex items-center gap-1 text-[10.5px] font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-2 py-0.5 rounded border border-emerald-200 transition"
              >
                🔗 Haydovchi biriktirish
              </button>
            </>
          )}
        </td>
        <td>
          <MonthlyFeeCell vehicle={vehicle} onSaved={reload} />
        </td>
        <td className="text-xs">
          {external?.licenseNumber ? (
            <>
              <p className="font-mono text-slate-700">{external.licenseNumber}</p>
              {external.licenseExpiresAt && (
                <p className="text-[11px] text-slate-400">
                  {t("licenseUntil")} {formatDate(external.licenseExpiresAt)}
                </p>
              )}
            </>
          ) : (
            "—"
          )}
        </td>
        <td>{vehicle.capacity > 0 ? vehicle.capacity : "—"}</td>
        <td>
          <StatusBadge status={vehicle.status} label={t(vehicle.status)} />
        </td>
        <td>
          {vehicle.contracts.length > 0 ? `${vehicle.contracts.length} ta` : t("noActiveContract")}
        </td>
        <td>
          <div className="flex gap-1.5">
            {vehicle.status === "ACTIVE" && (
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => void changeStatus(vehicle, "MAINTENANCE")}
              >
                {t("maintenance")}
              </button>
            )}
            {vehicle.status === "MAINTENANCE" && (
              <button
                type="button"
                className="btn-ghost text-xs text-emerald-700"
                onClick={() => void changeStatus(vehicle, "ACTIVE")}
              >
                {t("activate")}
              </button>
            )}
          </div>
        </td>
      </tr>
    );
  }

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <div className="card card-body mb-5">
        <h2 className="mb-4 text-sm font-bold text-slate-800">{t("addTitle")}</h2>
        <form onSubmit={onSubmit} className="space-y-4">
          {(formError || actionError) && <Alert tone="error">{formError ?? actionError}</Alert>}
          <div className="form-grid">
            <div>
              <label className="label" htmlFor="owner">
                {t("owner")}
              </label>
              <select
                id="owner"
                className="select"
                value={ownerId}
                onChange={(event) => setOwnerId(event.target.value)}
                required
              >
                {owners.data?.items.map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {owner.fullName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="plate">
                {t("plateNumber")}
              </label>
              <input
                id="plate"
                className="input font-mono uppercase"
                value={plateNumber}
                onChange={(event) => setPlateNumber(event.target.value.toUpperCase())}
                placeholder="01A123BC"
                minLength={3}
                maxLength={20}
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="model">
                {t("model")}
              </label>
              <input
                id="model"
                className="input"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="capacity">
                {t("capacity")}
              </label>
              <input
                id="capacity"
                type="number"
                min={0}
                max={120}
                className="input"
                value={capacity}
                onChange={(event) => setCapacity(event.target.value)}
                required
              />
            </div>
          </div>
          <button type="submit" className="btn-primary" disabled={saving || !ownerId}>
            {saving ? t("creating") : t("create")}
          </button>
        </form>
      </div>


      <div className="card mb-3 card-body flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <label className="label" htmlFor="vehicle-search">
            {tc("filters")}
          </label>
          <input
            id="vehicle-search"
            className="input"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("searchPlaceholder")}
          />
        </div>
        <div>
          <label className="label" htmlFor="route-filter">
            {t("route")}
          </label>
          <select
            id="route-filter"
            className="select w-60"
            value={routeFilter}
            onChange={(event) => setRouteFilter(event.target.value)}
          >
            <option value="">{t("allRoutes")}</option>
            <option value="none">{t("noRoute")}</option>
            {routeItems.map((route) => (
              <option key={route.id} value={route.id}>
                {route.name} ({route._count.vehicles})
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={grouped}
            onChange={(event) => setGrouped(event.target.checked)}
          />
          {t("groupByRoute")}
        </label>
        {grouped && (
          <div className="flex gap-1.5 pb-1">
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={() => setCollapsed(new Set(groups.map((group) => group.key)))}
            >
              {t("collapseAll")}
            </button>
            <button type="button" className="btn-ghost text-xs" onClick={() => setCollapsed(new Set())}>
              {t("expandAll")}
            </button>
          </div>
        )}
      </div>

      {notice && (
        <div className="mb-3">
          <Alert tone="success">{notice}</Alert>
        </div>
      )}

      <div className="card">
        {loading ? (
          <Loading label={tc("loading")} />
        ) : error ? (
          <div className="p-5">
            <Alert tone="error">{error}</Alert>
          </div>
        ) : data?.items.length === 0 ? (
          <EmptyState>{t("empty")}</EmptyState>
        ) : filtered.length === 0 ? (
          <EmptyState>{tc("none")}</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("plateNumber")}</th>
                  <th>{t("model")}</th>
                  <th>{t("route")}</th>
                  <th>{t("owner")}</th>
                  <th>{t("driver")}</th>
                  <th>{t("monthlyFee")}</th>
                  <th>{t("license")}</th>
                  <th>{t("capacity")}</th>
                  <th>{tc("status")}</th>
                  <th>{t("activeContract")}</th>
                  <th>{tc("actions")}</th>
                </tr>
              </thead>
              {groups.map((group) => {
                const isCollapsed = collapsed.has(group.key);
                return (
                  <tbody key={group.key}>
                    {grouped && (
                      <tr className="bg-slate-50">
                        <td colSpan={columnCount} className="py-2">
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                            <button
                              type="button"
                              className="flex items-center gap-2 text-left text-sm font-bold text-slate-800"
                              onClick={() => toggleGroup(group.key)}
                              aria-expanded={!isCollapsed}
                            >
                              <span className="w-3 text-slate-400">{isCollapsed ? "▸" : "▾"}</span>
                              {group.name}
                              <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                                {t("vehiclesCount", { count: group.items.length })}
                              </span>
                            </button>
                            {group.route ? (
                              <div className="flex items-center gap-2 text-xs text-slate-600">
                                <span>{t("routePlan")}:</span>
                                <RoutePlanInput
                                  routeId={group.route.id}
                                  value={group.route.monthlyPlan}
                                  onSaved={onPlanSaved}
                                />
                                <span className="text-[11px] text-slate-400">{t("routePlanHint")}</span>
                              </div>
                            ) : (
                              <span className="text-[11px] text-slate-400">{t("noRouteHint")}</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                    {!isCollapsed && group.items.map(vehicleRow)}
                  </tbody>
                );
              })}
            </table>
            {!grouped && filtered.length > pageSize && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-xs text-slate-600 bg-slate-50/50">
                <div>
                  Jami {filtered.length} ta transportdan {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, filtered.length)} ko&apos;rsatilmoqda
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
                    {page} / {Math.ceil(filtered.length / pageSize)}
                  </span>
                  <button
                    type="button"
                    disabled={page >= Math.ceil(filtered.length / pageSize)}
                    onClick={() => setPage((p) => p + 1)}
                    className="btn-secondary px-2.5 py-1 text-xs disabled:opacity-40"
                  >
                    Keyingi →
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Avtomobil biriktirish / Haydovchini qidirish Modal */}
      {assignVehicle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm animate-fadeIn">
          <div className="card w-full max-w-lg p-5 bg-white shadow-2xl rounded-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b pb-3 mb-4">
              <div>
                <h3 className="text-base font-bold text-slate-900">Avtomobil biriktirish</h3>
                <p className="text-xs text-slate-500">
                  Transportga amaldagi haydovchini qidirish va rasman biriktirish
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setAssignVehicle(null);
                  setSelectedDriver(null);
                  setDriverSearch("");
                }}
                className="text-slate-400 hover:text-slate-700 text-lg font-bold p-1 rounded-lg"
              >
                ✕
              </button>
            </div>

            {/* Target Vehicle info */}
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl mb-4 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-mono font-bold text-sm text-slate-900">
                  🇺🇿 {formatUzPlate(assignVehicle.plateNumber)}
                </span>
                <span className="font-semibold text-slate-700">{assignVehicle.model}</span>
              </div>
              <div className="mt-1.5 pt-1.5 border-t border-slate-200/70 text-slate-600 flex flex-wrap justify-between gap-2">
                <span>Egasi: <b>{assignVehicle.owner.fullName}</b></span>
                <span>
                  Hozirgi haydovchi:{" "}
                  <b>{assignVehicle.assignments[0]?.driver.fullName ?? "Biriktirilmagan"}</b>
                </span>
              </div>
            </div>

            {/* Driver Search Section */}
            <div className="mb-4">
              <label className="label font-bold text-xs text-slate-800 mb-1 flex items-center justify-between">
                <span>Haydovchini qidirish</span>
                {selectedDriver && (
                  <button
                    type="button"
                    onClick={() => setSelectedDriver(null)}
                    className="text-xs text-blue-600 hover:underline font-normal"
                  >
                    Boshqa haydovchi qidirish
                  </button>
                )}
              </label>

              {selectedDriver ? (
                <div className="p-3 bg-emerald-50 border border-emerald-300 rounded-xl flex items-center justify-between">
                  <div>
                    <div className="font-bold text-sm text-emerald-950">
                      ✅ {selectedDriver.fullName}
                    </div>
                    <div className="text-xs text-emerald-800 font-mono mt-0.5">
                      📞 {formatUzPhone(selectedDriver.phone)}{" "}
                      {selectedDriver.licenseNumber ? `· Guvohnoma: ${selectedDriver.licenseNumber}` : ""}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedDriver(null)}
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
                      placeholder="F.I.Sh yoki telefon raqami bo'yicha qidirish..."
                      value={driverSearch}
                      onChange={(e) => setDriverSearch(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          triggerDriverSearch();
                        }
                      }}
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={triggerDriverSearch}
                      className="btn-secondary px-3 py-1.5 text-xs font-semibold flex items-center gap-1 whitespace-nowrap shadow-sm"
                    >
                      🔍 Qidirish
                    </button>
                  </div>

                  {/* Driver search results list */}
                  <div className="border border-slate-200 rounded-xl max-h-48 overflow-y-auto divide-y divide-slate-100 bg-white shadow-inner">
                    {driverSearching ? (
                      <div className="p-4 text-center text-xs text-slate-500">Qidirilmoqda...</div>
                    ) : searchedDrivers.length === 0 ? (
                      <div className="p-4 text-center text-xs text-slate-400">
                        {driverSearch
                          ? "Mos keluvchi haydovchi topilmadi"
                          : "Haydovchini topish uchun ism yoki telefon kiriting"}
                      </div>
                    ) : (
                      searchedDrivers.map((d) => (
                        <div
                          key={d.id}
                          className="p-2.5 flex items-center justify-between hover:bg-slate-50 transition cursor-pointer"
                          onClick={() => setSelectedDriver(d)}
                        >
                          <div>
                            <p className="font-semibold text-xs text-slate-900">{d.fullName}</p>
                            <p className="font-mono text-[11px] text-slate-500">
                              {formatUzPhone(d.phone)}{" "}
                              {d.vehicle
                                ? `· Hozirgi: ${formatUzPlate(d.vehicle.plateNumber)} (${d.vehicle.model})`
                                : "· Mashina biriktirilmagan"}
                            </p>
                          </div>
                          <button
                            type="button"
                            className="btn-secondary text-xs px-2.5 py-1 text-emerald-700 hover:bg-emerald-50"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedDriver(d);
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

            {/* Date & Amount */}
            <form onSubmit={handleAssignSubmit} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label text-xs">Biriktirilgan sana</label>
                  <input
                    type="date"
                    className="input text-xs"
                    value={assignDate}
                    onChange={(e) => setAssignDate(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="label text-xs">Oylik plan (so&apos;m)</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    className="input text-xs"
                    value={assignAmount}
                    onChange={(e) => setAssignAmount(e.target.value)}
                    placeholder={assignVehicle.monthlyFee || "1500000"}
                  />
                </div>
              </div>

              {assignError && <Alert tone="error">{assignError}</Alert>}

              <div className="flex justify-end gap-2 pt-3 border-t mt-4">
                <button
                  type="button"
                  className="btn-secondary text-xs"
                  onClick={() => setAssignVehicle(null)}
                  disabled={assignSaving}
                >
                  Bekor qilish
                </button>
                <button
                  type="submit"
                  className="btn-primary text-xs"
                  disabled={assignSaving || !selectedDriver}
                >
                  {assignSaving ? "Biriktirilmoqda..." : "✅ Biriktirish"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
