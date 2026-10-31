"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { apiRequest } from "@/lib/client-api";
import { formatDate, formatMoney, useApi } from "@/lib/use-api";
import type { Contract, ExternalRecordRow, Tariff, Vehicle } from "@/lib/types";
import { Alert, EmptyState, Loading, PageHeader, StatusBadge } from "@/components/ui";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function ContractsPage() {
  const t = useTranslations("contracts");
  const tc = useTranslations("common");
  const { data, loading, error, reload } = useApi<{ items: Contract[] }>("/contracts");
  const vehicles = useApi<{ items: Vehicle[] }>("/vehicles");
  const tariffs = useApi<{ items: Tariff[] }>("/tariffs");
  const external = useApi<{ items: ExternalRecordRow[] }>(
    "/registry/records?kind=CONTRACT&limit=500",
  );

  const [vehicleId, setVehicleId] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [tariffId, setTariffId] = useState("");
  const [type, setType] = useState<"SELF_USE" | "LEASE" | "SERVICE">("LEASE");
  const [startDate, setStartDate] = useState(today());
  const [endDate, setEndDate] = useState("");
  const [monthlyRate, setMonthlyRate] = useState("0.00");
  const [notes, setNotes] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [extPage, setExtPage] = useState(1);
  const extPageSize = 25;

  const extItems = useMemo(() => external.data?.items ?? [], [external.data]);
  const extTotalPages = Math.ceil(extItems.length / extPageSize) || 1;
  const pagedExtItems = useMemo(() => {
    const start = (extPage - 1) * extPageSize;
    return extItems.slice(start, start + extPageSize);
  }, [extItems, extPage, extPageSize]);

  useEffect(() => {
    if (!vehicleId && vehicles.data?.items[0]) {
      const first = vehicles.data.items[0];
      setVehicleId(first.id);
      setOwnerId(first.owner.id);
    }
  }, [vehicleId, vehicles.data]);

  function onVehicleChange(id: string) {
    setVehicleId(id);
    const vehicle = vehicles.data?.items.find((item) => item.id === id);
    setOwnerId(vehicle?.owner.id ?? "");
  }

  function onTypeChange(value: typeof type) {
    setType(value);
    if (value === "SELF_USE") setMonthlyRate("0.00");
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setSaving(true);
    try {
      await apiRequest<Contract>("/contracts", {
        method: "POST",
        body: {
          vehicleId,
          ownerId,
          ...(tariffId ? { tariffId } : {}),
          type,
          startDate,
          ...(endDate ? { endDate } : {}),
          ...(type !== "SELF_USE" ? { monthlyRate } : {}),
          ...(notes ? { notes } : {}),
        },
      });
      setNotes("");
      setTariffId("");
      await reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : tc("error"));
    } finally {
      setSaving(false);
    }
  }

  async function activate(contract: Contract) {
    setActionError(null);
    try {
      await apiRequest(`/contracts/${contract.id}/activate`, { method: "POST", body: {} });
      await reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : tc("error"));
    }
  }

  async function terminate(contract: Contract) {
    if (!window.confirm(tc("confirm"))) return;
    setActionError(null);
    try {
      await apiRequest(`/contracts/${contract.id}/terminate`, {
        method: "POST",
        body: {},
      });
      await reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : tc("error"));
    }
  }

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <div className="card card-body mb-5">
        <h2 className="mb-1 text-sm font-bold text-slate-800">{t("addTitle")}</h2>
        <p className="mb-4 text-xs text-slate-500">{t("draftHint")}</p>
        <form onSubmit={onSubmit} className="space-y-4">
          {(formError || actionError) && <Alert tone="error">{formError ?? actionError}</Alert>}
          <div className="form-grid">
            <div>
              <label className="label" htmlFor="contract-vehicle">
                {t("vehicle")}
              </label>
              <select
                id="contract-vehicle"
                className="select"
                value={vehicleId}
                onChange={(event) => onVehicleChange(event.target.value)}
                required
              >
                {vehicles.data?.items
                  .filter((vehicle) => vehicle.status !== "INACTIVE")
                  .map((vehicle) => (
                    <option key={vehicle.id} value={vehicle.id}>
                      {vehicle.plateNumber} — {vehicle.model}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <span className="label">{t("owner")}</span>
              <div className="input bg-slate-50 text-slate-500">
                {vehicles.data?.items.find((item) => item.id === vehicleId)?.owner.fullName ?? "—"}
              </div>
            </div>
            <div>
              <label className="label" htmlFor="contract-type">
                {t("type")}
              </label>
              <select
                id="contract-type"
                className="select"
                value={type}
                onChange={(event) => onTypeChange(event.target.value as typeof type)}
              >
                <option value="LEASE">{t("LEASE")}</option>
                <option value="SERVICE">{t("SERVICE")}</option>
                <option value="SELF_USE">{t("SELF_USE")}</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="contract-tariff">
                {t("tariff")}
              </label>
              <select
                id="contract-tariff"
                className="select"
                value={tariffId}
                onChange={(event) => setTariffId(event.target.value)}
              >
                <option value="">—</option>
                {tariffs.data?.items
                  .filter((tariff) => tariff.isActive)
                  .map((tariff) => (
                    <option key={tariff.id} value={tariff.id}>
                      {tariff.name}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="start-date">
                {t("startDate")}
              </label>
              <input
                id="start-date"
                type="date"
                className="input"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="end-date">
                {t("endDate")}
              </label>
              <input
                id="end-date"
                type="date"
                className="input"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
              />
            </div>
            {type !== "SELF_USE" && (
              <div>
                <label className="label" htmlFor="monthly-rate">
                  {t("monthlyRate")}
                </label>
                <input
                  id="monthly-rate"
                  className="input"
                  inputMode="decimal"
                  value={monthlyRate}
                  onChange={(event) => setMonthlyRate(event.target.value)}
                  required
                />
              </div>
            )}
            <div className="field-full">
              <label className="label" htmlFor="notes">
                {t("notes")}
              </label>
              <textarea
                id="notes"
                className="input min-h-20"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </div>
          </div>
          <button type="submit" className="btn-primary" disabled={saving || !vehicleId}>
            {saving ? t("creating") : t("create")}
          </button>
        </form>
      </div>

      <div className="card">
        {loading ? (
          <Loading label={tc("loading")} />
        ) : error ? (
          <div className="p-5">
            <Alert tone="error">{error}</Alert>
          </div>
        ) : data?.items.length === 0 ? (
          <EmptyState>{t("empty")}</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("vehicle")}</th>
                  <th>{t("owner")}</th>
                  <th>{t("type")}</th>
                  <th>{t("tariff")}</th>
                  <th>{t("monthlyRate")}</th>
                  <th>{t("startDate")}</th>
                  <th>{tc("status")}</th>
                  <th>{tc("actions")}</th>
                </tr>
              </thead>
              <tbody>
                {data?.items.map((contract) => (
                  <tr key={contract.id}>
                    <td>
                      <p className="font-semibold text-slate-900">
                        {contract.vehicle.plateNumber}
                      </p>
                      <p className="text-xs text-slate-400">{contract.vehicle.model}</p>
                    </td>
                    <td>{contract.owner.fullName}</td>
                    <td>{t(contract.type)}</td>
                    <td>{contract.tariff?.name ?? "—"}</td>
                    <td>{formatMoney(contract.monthlyRate)}</td>
                    <td className="whitespace-nowrap">{formatDate(contract.startDate)}</td>
                    <td>
                      <StatusBadge status={contract.status} label={t(contract.status)} />
                    </td>
                    <td>
                      <div className="flex gap-1.5">
                        {contract.status === "DRAFT" && (
                          <button
                            type="button"
                            className="btn-ghost text-xs text-emerald-700"
                            onClick={() => void activate(contract)}
                          >
                            {t("activate")}
                          </button>
                        )}
                        {contract.status !== "TERMINATED" && (
                          <button
                            type="button"
                            className="btn-ghost text-xs text-red-600"
                            onClick={() => void terminate(contract)}
                          >
                            {t("terminate")}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card mt-5">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-sm font-bold text-slate-800">{t("externalTitle")}</h2>
          <p className="mt-1 text-xs text-slate-500">{t("externalHint")}</p>
        </div>
        {external.loading ? (
          <Loading label={tc("loading")} />
        ) : external.error ? (
          <div className="p-5">
            <Alert tone="error">{external.error}</Alert>
          </div>
        ) : !external.data?.items.length ? (
          <EmptyState>{t("externalEmpty")}</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("externalNumber")}</th>
                  <th>{t("externalDirection")}</th>
                  <th>{tc("status")}</th>
                  <th>{t("startDate")}</th>
                  <th>{t("endDate")}</th>
                </tr>
              </thead>
              <tbody>
                {pagedExtItems.map((row) => (
                  <tr key={row.id}>
                    <td className="font-mono text-xs font-semibold text-slate-900">
                      {row.number ?? row.externalId}
                    </td>
                    <td className="max-w-xs text-slate-700">{row.title ?? "—"}</td>
                    <td>
                      {row.status ? (
                        <StatusBadge status={row.status.toUpperCase()} label={row.status} />
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="whitespace-nowrap text-xs text-slate-600">
                      {formatDate(row.startsAt ?? row.issuedAt)}
                    </td>
                    <td className="whitespace-nowrap text-xs text-slate-600">
                      {formatDate(row.endsAt ?? row.expiresAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {extTotalPages > 1 && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-xs text-slate-600 bg-slate-50/50">
                <div>
                  Jami {extItems.length} ta tashqi shartnomadan {(extPage - 1) * extPageSize + 1}–{Math.min(extPage * extPageSize, extItems.length)} ko&apos;rsatilmoqda
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={extPage <= 1}
                    onClick={() => setExtPage((p) => p - 1)}
                    className="btn-secondary px-2.5 py-1 text-xs disabled:opacity-40"
                  >
                    ← Oldingi
                  </button>
                  <span className="px-2 font-medium">
                    {extPage} / {extTotalPages}
                  </span>
                  <button
                    type="button"
                    disabled={extPage >= extTotalPages}
                    onClick={() => setExtPage((p) => p + 1)}
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
    </>
  );
}
