"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { apiRequest } from "@/lib/client-api";
import { formatDate, formatDateTime, formatMoney, useApi } from "@/lib/use-api";
import type {
  CrossLinkedVehicleView,
  ExternalRecordKind,
  ExternalRecordRow,
  ExternalVehicleRow,
} from "@/lib/types";
import { Alert, EmptyState, Loading, PageHeader, StatCard, StatusBadge } from "@/components/ui";

type TabKey = "unified" | "vehicles" | ExternalRecordKind;

const TABS: Array<{ key: TabKey }> = [
  { key: "unified" },
  { key: "RENT_CONTRACT" },
  { key: "vehicles" },
  { key: "CONTRACT_APPLICATION" },
  { key: "CONTRACT" },
  { key: "CERTIFICATE" },
  { key: "TENDER_APPLICATION" },
];

/**
 * 3 ta davlat tizimini (ijara.soliq.uz, e-tender.uztrans.uz, bm.dtransport.uz)
 * bitta transport kartochkasida ko'rsatuvchi 360° reyestr
 */
function UnifiedCrossLinkTable({ search }: { search: string }) {
  const t = useTranslations("registry");
  const tc = useTranslations("common");
  const { data, loading, error, reload } = useApi<{
    items: CrossLinkedVehicleView[];
    totals: {
      totalVehicles: number;
      fullyCompliant: number;
      partial: number;
      expired: number;
      noRentContract: number;
    };
  }>("/registry/cross-link");

  const [linking, setLinking] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = 50;

  useEffect(() => {
    setPage(1);
  }, [search]);

  const items = useMemo(() => {
    const rows = data?.items ?? [];
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) =>
      [
        row.plateNumber,
        row.model,
        row.vin,
        row.ijara?.contractNumber,
        row.ijara?.lessee?.fullName,
        row.etender?.licenseNumber,
        row.etender?.routeName,
        row.autopark?.garageNumber,
      ]
        .filter(Boolean)
        .some((val) => val!.toLowerCase().includes(needle)),
    );
  }, [data, search]);

  const totalPages = Math.ceil(items.length / pageSize) || 1;
  const pagedItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, page, pageSize]);

  async function handleAutoLink() {
    setLinking(true);
    setActionMsg(null);
    try {
      const res = await apiRequest<{
        linkedVehicles: number;
        createdVehicles: number;
        createdDrivers: number;
        seededContracts?: number;
      }>("/registry/cross-link/auto", { method: "POST" });
      setActionMsg(
        `Bog'lash yakunlandi: ${res.linkedVehicles} ta mashina ulandi, ${res.createdVehicles} ta yangi avtomobil, ${res.createdDrivers} ta haydovchi biriktirildi${res.seededContracts ? `, ${res.seededContracts} ta Soliq ijara shartnomasi bog'landi` : ""}.`,
      );
      await reload();
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : tc("error"));
    } finally {
      setLinking(false);
    }
  }

  if (loading && !data) return <Loading label={tc("loading")} />;
  if (error) return <Alert tone="error">{error}</Alert>;

  return (
    <div className="space-y-4">
      {/* 3 ta portal statistika kartalari */}
      {data?.totals && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 p-4 pb-0">
          <StatCard
            label="Jami avtomobillar"
            value={data.totals.totalVehicles}
            hint="3 ta portalda mavjud transportlar"
            tone="blue"
          />
          <StatCard
            label="To'liq qonuniy (360°)"
            value={data.totals.fullyCompliant}
            hint="Soliq ijara + E-Tender litsenziya faol"
            tone="emerald"
          />
          <StatCard
            label="Ijara shartnomasi yo'q"
            value={data.totals.noRentContract}
            hint="ijara.soliq.uz da ro'yxatdan o'tmagan"
            tone="amber"
          />
          <StatCard
            label="Muddati o'tgan"
            value={data.totals.expired}
            hint="Shartnoma yoki litsenziya muddati tugagan"
            tone="red"
          />
        </div>
      )}

      {/* Amallar va avtomatik bog'lash tugmasi */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-2">
        <div className="text-xs text-slate-500">
          Ushbu jadval <b>ijara.soliq.uz</b>, <b>e-tender.uztrans.uz</b> va <b>bm.dtransport.uz</b> tizimlarini davlat raqami bo&apos;yicha birlashtiradi.
        </div>
        <button
          type="button"
          onClick={() => void handleAutoLink()}
          disabled={linking}
          className="btn-primary px-3 py-1.5 text-xs font-semibold"
        >
          {linking ? "Bog'lanmoqda..." : "⚡ Avtomatik bog'lash (3 portal)"}
        </button>
      </div>

      {actionMsg && (
        <div className="px-4">
          <Alert tone="success">{actionMsg}</Alert>
        </div>
      )}

      {!items.length ? (
        <div className="p-4">
          <EmptyState>
            Tashqi tizimlardan ma&apos;lumot topilmadi. Sozlamalar bo&apos;limida OneID orqali ulaning va sinxronlang.
          </EmptyState>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Avtomobil</th>
                <th>📑 Soliq Ijara (ijara.soliq.uz)</th>
                <th>📜 E-Tender (uztrans.uz)</th>
                <th>🚌 BM Monitoring (dtransport.uz)</th>
                <th>👤 Ijarachi / Haydovchi</th>
                <th>Qonuniylik holati</th>
              </tr>
            </thead>
            <tbody>
              {pagedItems.map((row) => {
                const ijara = row.ijara;
                const etender = row.etender;
                const bm = row.autopark;

                return (
                  <tr key={row.normalizedPlate} className="hover:bg-slate-50/70 transition-colors">
                    <td>
                      <div className="font-mono font-bold text-slate-900">{row.plateNumber}</div>
                      <div className="text-xs text-slate-600">{row.model ?? "—"}</div>
                      {row.vin && <div className="font-mono text-[10px] text-slate-400">VIN: {row.vin}</div>}
                    </td>

                    {/* 1. Soliq yoki ichki ijara shartnomasi */}
                    <td className="text-xs">
                      {ijara ? (
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5 font-semibold text-slate-800">
                            <span>#{ijara.contractNumber}</span>
                            {!ijara.contractViewUrl.includes("soliq.uz") && (
                              <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                                Ichki ijara
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {ijara.startsAt ? formatDate(ijara.startsAt) : "—"} —{" "}
                            <span className={ijara.isExpired ? "font-bold text-rose-600" : ""}>
                              {ijara.endsAt ? formatDate(ijara.endsAt) : "—"}
                            </span>
                          </div>
                          {ijara.monthlyFee && (
                            <div className="font-medium text-slate-700">
                              {formatMoney(ijara.monthlyFee)} so&apos;m/oy
                            </div>
                          )}
                          {ijara.contractViewUrl.includes("soliq.uz") ? (
                            <a
                              href={ijara.contractViewUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 rounded bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 hover:bg-blue-100"
                            >
                              <span>Soliqda ko&apos;rish</span>
                              <span>↗</span>
                            </a>
                          ) : (
                            <a
                              href="/contracts"
                              className="inline-flex items-center gap-1 rounded bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100"
                            >
                              <span>Shartnomalarda ko&apos;rish</span>
                              <span>↗</span>
                            </a>
                          )}
                        </div>
                      ) : (
                        <span className="rounded bg-rose-50 px-2 py-1 text-[11px] font-medium text-rose-700">
                          ⚠️ Ijara shartnomasi yo&apos;q
                        </span>
                      )}
                    </td>

                    {/* 2. E-Tender litsenziyasi */}
                    <td className="text-xs">
                      {etender ? (
                        <div className="space-y-1">
                          <div className="font-mono font-medium text-slate-800">
                            Lits: {etender.licenseNumber ?? "Mavjud"}
                          </div>
                          {etender.licenseExpiresAt && (
                            <div className="text-[11px] text-slate-500">
                              Muddati:{" "}
                              <span className={etender.isExpired ? "font-bold text-rose-600" : ""}>
                                {formatDate(etender.licenseExpiresAt)}
                              </span>
                            </div>
                          )}
                          {etender.routeName && (
                            <div className="text-[11px] text-slate-600 truncate max-w-[160px]" title={etender.routeName}>
                              🛣 {etender.routeName}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-[11px] text-slate-400">Litsenziya topilmadi</span>
                      )}
                    </td>

                    {/* 3. Toshkent BM Garaj & GPS */}
                    <td className="text-xs">
                      {bm ? (
                        <div className="space-y-1">
                          {bm.garageNumber && (
                            <div>
                              Garaj: <b>#{bm.garageNumber}</b>
                            </div>
                          )}
                          {bm.gpsImei && (
                            <div className="font-mono text-[10px] text-slate-500">
                              IMEI: {bm.gpsImei}
                            </div>
                          )}
                          {bm.routeName && (
                            <div className="text-[11px] text-slate-600 truncate max-w-[140px]">
                              {bm.routeName}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-[11px] text-slate-400">—</span>
                      )}
                    </td>

                    {/* 4. Ijarachi haydovchi */}
                    <td className="text-xs">
                      {ijara?.lessee?.fullName ? (
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-1.5 font-semibold text-slate-900">
                            <span>{ijara.lessee.fullName}</span>
                            <span className="rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-700">
                              {ijara.contractViewUrl.includes("soliq.uz") ? "Soliq ijarachi" : "Ijarachi"}
                            </span>
                          </div>
                          {ijara.lessee.phone && (
                            <div className="text-[11px] text-slate-500">
                              {ijara.lessee.phone}
                            </div>
                          )}
                          {ijara.lessee.pinfl && (
                            <div className="font-mono text-[10px] text-slate-400">
                              JSHSHIR: {ijara.lessee.pinfl}
                            </div>
                          )}
                        </div>
                      ) : row.nativeDriver?.fullName ? (
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-1.5 font-semibold text-slate-900">
                            <span>{row.nativeDriver.fullName}</span>
                            <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                              Tizim haydovchisi
                            </span>
                          </div>
                          {row.nativeDriver.phone && (
                            <div className="text-[11px] text-slate-500">
                              {row.nativeDriver.phone}
                            </div>
                          )}
                        </div>
                      ) : bm?.drivers && bm.drivers.length > 0 ? (
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-1.5 font-medium text-slate-800">
                            <span>{bm.drivers[0]?.fullName}</span>
                            <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                              BM
                            </span>
                          </div>
                          {bm.drivers[0]?.phone && (
                            <div className="text-[11px] text-slate-500">
                              {bm.drivers[0].phone}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-[11px] text-slate-400">Biriktirilmagan</span>
                      )}
                    </td>

                    {/* 5. Qonuniylik holati */}
                    <td>
                      {row.complianceStatus === "FULLY_COMPLIANT" ? (
                        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
                          <span>✅</span>
                          <span>To&apos;liq qonuniy</span>
                        </span>
                      ) : row.complianceStatus === "NO_RENT_CONTRACT" ? (
                        <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700 ring-1 ring-inset ring-amber-600/20">
                          <span>⚠️</span>
                          <span>Ijara yo&apos;q</span>
                        </span>
                      ) : row.complianceStatus === "EXPIRED" ? (
                        <span className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700 ring-1 ring-inset ring-rose-600/20">
                          <span>🛑</span>
                          <span>Muddati o&apos;tgan</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">
                          <span>Qisman</span>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {totalPages > 1 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-xs text-slate-600 bg-slate-50/50">
              <div>
                Jami {items.length} ta yozuvdan {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, items.length)} ko&apos;rsatilmoqda
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
      )}
    </div>
  );
}

function VehicleTable({ search }: { search: string }) {
  const t = useTranslations("registry");
  const tc = useTranslations("common");
  const { data, loading, error } = useApi<{ items: ExternalVehicleRow[] }>(
    "/registry/vehicles?limit=500",
  );

  const [page, setPage] = useState(1);
  const pageSize = 50;

  useEffect(() => {
    setPage(1);
  }, [search]);

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

  const totalPages = Math.ceil(items.length / pageSize) || 1;
  const pagedItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, page, pageSize]);

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
          {pagedItems.map((row) => (
            <tr key={row.id}>
              <td className="font-mono font-semibold text-slate-900">
                {row.plateNumber ?? "—"}
                <p className="text-[10px] font-normal uppercase tracking-wide text-slate-400">
                  {row.provider === "ETENDER"
                    ? "e-tender"
                    : row.provider === "IJARA"
                      ? "ijara.soliq.uz"
                      : "autopark"}
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
      {totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-xs text-slate-600 bg-slate-50/50">
          <div>
            Jami {items.length} ta yozuvdan {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, items.length)} ko&apos;rsatilmoqda
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
  );
}

function RecordTable({ kind }: { kind: ExternalRecordKind }) {
  const t = useTranslations("registry");
  const tc = useTranslations("common");
  const { data, loading, error } = useApi<{ items: ExternalRecordRow[] }>(
    `/registry/records?kind=${kind}&limit=500`,
  );
  const [page, setPage] = useState(1);
  const pageSize = 50;

  useEffect(() => {
    setPage(1);
  }, [kind]);

  const items = data?.items ?? [];
  const totalPages = Math.ceil(items.length / pageSize) || 1;
  const pagedItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, page, pageSize]);

  if (loading) return <Loading label={tc("loading")} />;
  if (error) return <Alert tone="error">{error}</Alert>;
  if (!items.length) return <EmptyState>{t("empty")}</EmptyState>;

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
            {kind === "RENT_CONTRACT" && <th>Soliq havolasi</th>}
            <th>{t("syncedAt")}</th>
          </tr>
        </thead>
        <tbody>
          {pagedItems.map((row) => {
            const raw = (row as any).raw ?? {};
            const viewUrl = raw.contractViewUrl;
            return (
              <tr key={row.id}>
                <td className="font-mono text-xs font-semibold text-slate-900">
                  {row.number ?? row.externalId}
                </td>
                <td className="max-w-xs text-slate-700">
                  <div>{row.title ?? "—"}</div>
                  {raw.lessee_name && (
                    <div className="text-[11px] text-slate-500">
                      Ijarachi: {raw.lessee_name} {raw.lessee_phone ? `(${raw.lessee_phone})` : ""}
                    </div>
                  )}
                  {raw.monthlyFee && (
                    <div className="font-medium text-emerald-700 text-[11px]">
                      Ijara: {formatMoney(raw.monthlyFee)} so&apos;m
                    </div>
                  )}
                </td>
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
                {kind === "RENT_CONTRACT" && (
                  <td>
                    {viewUrl ? (
                      <a
                        href={viewUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-secondary px-2.5 py-1 text-xs text-blue-700 font-semibold inline-flex items-center gap-1"
                      >
                        <span>Soliqda ko&apos;rish</span>
                        <span>↗</span>
                      </a>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                )}
                <td className="text-[11px] text-slate-400">{formatDateTime(row.syncedAt)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-xs text-slate-600 bg-slate-50/50">
          <div>
            Jami {items.length} ta yozuvdan {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, items.length)} ko&apos;rsatilmoqda
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
  );
}

export default function RegistryPage() {
  const t = useTranslations("registry");
  const [tab, setTab] = useState<TabKey>("unified");
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
                  ? "bg-brand-600 text-white shadow-xs"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {t(`tabs.${item.key}`)}
            </button>
          ))}
        </div>
        {(tab === "unified" || tab === "vehicles") && (
          <input
            className="input sm:max-w-xs"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("searchPlaceholder")}
          />
        )}
      </div>

      <div className="card">
        {tab === "unified" ? (
          <UnifiedCrossLinkTable search={search} />
        ) : tab === "vehicles" ? (
          <VehicleTable search={search} />
        ) : (
          <RecordTable kind={tab} />
        )}
      </div>
    </>
  );
}
