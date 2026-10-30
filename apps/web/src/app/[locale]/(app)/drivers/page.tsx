"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { apiRequest } from "@/lib/client-api";
import { formatDate, formatDateTime, formatMoney, useApi } from "@/lib/use-api";
import type { DriverItem, DriverProfile, Vehicle } from "@/lib/types";
import { Alert, EmptyState, Loading, PageHeader, StatusBadge } from "@/components/ui";
import { todayTashkent } from "@/lib/tashkent";
import { DriverAvatar, DriverDocuments } from "@/components/driver-documents";

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
  const [linkCodes, setLinkCodes] = useState<
    Record<string, { code: string; expiresAt: string }>
  >({});

  useEffect(() => {
    setAssignVehicleId("");
    setAssignDate(todayTashkent());
    setAssignAmount("");
    setActionError(null);
    setActionOk(null);
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

  const data = profile.data;

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
          <h2 className="text-sm font-bold text-slate-800">{t("title")}</h2>
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
    </>
  );
}
