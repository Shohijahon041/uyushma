"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { formatDate, formatDateTime, useApi } from "@/lib/use-api";
import type {
  ExternalRecordKind,
  ExternalRecordRow,
  ExternalVehicleRow,
} from "@/lib/types";
import { Alert, EmptyState, Loading, PageHeader, StatusBadge } from "@/components/ui";

type TabKey = "vehicles" | ExternalRecordKind;

const TABS: Array<{ key: TabKey }> = [
  { key: "vehicles" },
  { key: "CONTRACT_APPLICATION" },
  { key: "CONTRACT" },
  { key: "CERTIFICATE" },
  { key: "TENDER_APPLICATION" },
];

function VehicleTable({ search }: { search: string }) {
  const t = useTranslations("registry");
  const tc = useTranslations("common");
  const { data, loading, error } = useApi<{ items: ExternalVehicleRow[] }>(
    "/registry/vehicles?limit=500",
  );

  const items = useMemo(() => {
    const rows = data?.items ?? [];
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) =>
      [row.plateNumber, row.garageNumber, row.vin, row.organizationName, row.vehicleModel]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(needle)),
    );
  }, [data, search]);

  if (loading) return <Loading label={tc("loading")} />;
  if (error) return <Alert tone="error">{error}</Alert>;
  if (!items.length) return <EmptyState>{t("empty")}</EmptyState>;

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>{t("plateNumber")}</th>
            <th>{t("garageNumber")}</th>
            <th>{t("model")}</th>
            <th>{t("organization")}</th>
            <th>{t("route")}</th>
            <th>{t("gpsImei")}</th>
            <th>{t("license")}</th>
            <th>{t("projectVehicle")}</th>
            <th>{t("syncedAt")}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((row) => (
            <tr key={row.id}>
              <td className="font-mono font-semibold text-slate-900">
                {row.plateNumber ?? "—"}
                <p className="text-[10px] font-normal uppercase tracking-wide text-slate-400">
                  {row.provider === "ETENDER" ? "e-tender" : "autopark"}
                </p>
              </td>
              <td className="font-mono text-xs">{row.garageNumber ?? "—"}</td>
              <td>
                <p className="text-slate-800">{row.vehicleModel ?? "—"}</p>
                {row.vehicleClass && (
                  <p className="text-[11px] text-slate-400">{row.vehicleClass}</p>
                )}
              </td>
              <td className="text-xs text-slate-600">{row.organizationName ?? "—"}</td>
              <td className="text-xs text-slate-600">
                {row.routeNumber ? `${row.routeNumber} · ` : ""}
                {row.routeName ?? "—"}
              </td>
              <td className="font-mono text-xs text-slate-500">{row.gpsImei ?? "—"}</td>
              <td className="text-xs">
                <p className="font-mono text-slate-700">{row.licenseNumber ?? "—"}</p>
                {row.licenseExpiresAt && (
                  <p className="text-[11px] text-slate-400">
                    {t("licenseUntil")} {formatDate(row.licenseExpiresAt)}
                  </p>
                )}
              </td>
              <td>
                {row.vehicle ? (
                  <StatusBadge status={row.vehicle.status} label={t("matched")} />
                ) : (
                  <span className="text-[11px] text-slate-400">{t("notMatched")}</span>
                )}
              </td>
              <td className="text-[11px] text-slate-400">{formatDateTime(row.syncedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RecordTable({ kind }: { kind: ExternalRecordKind }) {
  const t = useTranslations("registry");
  const tc = useTranslations("common");
  const { data, loading, error } = useApi<{ items: ExternalRecordRow[] }>(
    `/registry/records?kind=${kind}&limit=500`,
  );

  if (loading) return <Loading label={tc("loading")} />;
  if (error) return <Alert tone="error">{error}</Alert>;
  if (!data?.items.length) return <EmptyState>{t("empty")}</EmptyState>;

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>{t("number")}</th>
            <th>{t("recordTitle")}</th>
            <th>{tc("status")}</th>
            <th>{t("validFrom")}</th>
            <th>{t("validUntil")}</th>
            <th>{t("syncedAt")}</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((row) => (
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
              <td className="text-xs text-slate-600">
                {formatDate(row.issuedAt ?? row.startsAt)}
              </td>
              <td className="text-xs text-slate-600">
                {formatDate(row.expiresAt ?? row.endsAt)}
              </td>
              <td className="text-[11px] text-slate-400">{formatDateTime(row.syncedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function RegistryPage() {
  const t = useTranslations("registry");
  const [tab, setTab] = useState<TabKey>("vehicles");
  const [search, setSearch] = useState("");

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                tab === item.key
                  ? "bg-brand-50 text-brand-800"
                  : "text-slate-500 hover:bg-slate-100"
              }`}
            >
              {t(`tabs.${item.key}`)}
            </button>
          ))}
        </div>
        {tab === "vehicles" && (
          <input
            className="input sm:max-w-xs"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("searchPlaceholder")}
          />
        )}
      </div>

      <div className="card">
        {tab === "vehicles" ? <VehicleTable search={search} /> : <RecordTable kind={tab} />}
      </div>
    </>
  );
}
