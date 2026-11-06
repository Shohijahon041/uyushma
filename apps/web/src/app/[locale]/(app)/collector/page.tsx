"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { apiRequest } from "@/lib/client-api";
import { useApi } from "@/lib/use-api";
import type { AuthUser } from "@/lib/types";
import { Alert, EmptyState, Loading, PageHeader, StatCard, StatusBadge } from "@/components/ui";

interface CollectorSummary {
  total_records: number;
  total_vehicles: number;
  by_source: Record<string, number>;
  recent_logs?: Array<{
    source: string;
    status: string;
    items: number;
    duration: number;
    at: string;
    error?: string;
  }>;
}

interface CollectorStatusResponse {
  online: boolean;
  baseUrl: string;
  summary?: CollectorSummary;
  error?: string;
}

interface CollectorRecord {
  id: number;
  source: string;
  external_id: string;
  record_type: string;
  identifier: string | null;
  title: string | null;
  status: string;
  starts_at: string | null;
  ends_at: string | null;
  amount: number;
  parties: {
    lessor_name?: string;
    lessee_name?: string;
    lessor_phone?: string;
    lessee_phone?: string;
    lessor_id?: string;
    organization_name?: string;
    driver_name?: string;
  } | null;
  raw_data?: Record<string, any>;
  synced_at: string | null;
  updated_at: string | null;
}

export default function CollectorPage() {
  const tc = useTranslations("common");
  const router = useRouter();
  const me = useApi<AuthUser>("/auth/me");
  const allowed = me.data?.isSuperAdmin === true;

  const { data: statusData, loading: statusLoading, reload: reloadStatus } =
    useApi<CollectorStatusResponse>(allowed ? "/collector/status" : null);

  const [records, setRecords] = useState<CollectorRecord[]>([]);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [syncing, setSyncing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<CollectorRecord | null>(null);

  async function loadRecords() {
    setLoadingRecords(true);
    try {
      const params = new URLSearchParams();
      if (sourceFilter) params.set("source", sourceFilter);
      if (typeFilter) params.set("record_type", typeFilter);
      if (search) params.set("search", search);
      params.set("pageSize", "100");

      const res = await apiRequest<CollectorRecord[]>(`/collector/records?${params.toString()}`);
      setRecords(res || []);
    } catch (err) {
      console.error("Yozuvlarni yuklashda xatolik:", err);
    } finally {
      setLoadingRecords(false);
    }
  }

  useEffect(() => {
    if (!allowed) return;
    const timer = setTimeout(() => {
      void loadRecords();
    }, 300);
    return () => clearTimeout(timer);
  }, [sourceFilter, typeFilter, search, allowed]);

  useEffect(() => {
    if (!me.loading && me.data && !allowed) {
      router.replace("/dashboard");
    }
  }, [allowed, me.data, me.loading, router]);

  async function handleTriggerSync() {
    setSyncing(true);
    setMessage(null);
    try {
      const res = await apiRequest<{ status: string; message: string }>("/collector/sync", {
        method: "POST",
      });
      setMessage({
        type: "success",
        text: `Kollektor ishga tushirildi: ${res.message}. Jarayon orqa fonda 3 ta portalni (Soliq, e-tender, bm) tekshiradi.`,
      });
      await reloadStatus();
      setTimeout(() => void loadRecords(), 3000);
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : tc("error"),
      });
    } finally {
      setSyncing(false);
    }
  }

  async function handleImportToMainDb() {
    setImporting(true);
    setMessage(null);
    try {
      const res = await apiRequest<{
        importedContracts: number;
        createdVehicles: number;
        createdDrivers: number;
        assignedVehicles: number;
      }>("/collector/import", { method: "POST" });
      setMessage({
        type: "success",
        text: `Asosiy tizimga muvaffaqiyatli integratsiya qilindi: ${res.importedContracts} ta shartnoma, ${res.createdVehicles} ta yangi avtomobil, ${res.createdDrivers} ta haydovchi yaratildi va ${res.assignedVehicles} ta mashinaga biriktirildi!`,
      });
      await reloadStatus();
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : tc("error"),
      });
    } finally {
      setImporting(false);
    }
  }

  if (me.loading && !me.data) return <Loading label={tc("loading")} />;
  if (!allowed) return null;

  const summary = statusData?.summary;
  const isOnline = statusData?.online ?? false;

  const latestLogBySource = new Map<string, NonNullable<CollectorSummary["recent_logs"]>[number]>();
  for (const log of summary?.recent_logs ?? []) {
    if (!latestLogBySource.has(log.source)) latestLogBySource.set(log.source, log);
  }
  const brokenSources = [...latestLogBySource.values()].filter(
    (log) => log.status !== "SUCCESS",
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tashqi Manbalar Kollektori"
        subtitle="ijara.soliq.uz, e-tender.uztrans.uz va bm.dtransport.uz portallaridan yig'ilgan yagona ma'lumotlar bazasi"
        action={
          <div className="flex flex-wrap items-center gap-2">
            {me.data && !me.data.company.isPlatform && (
              <button
                type="button"
                onClick={() => void handleImportToMainDb()}
                disabled={importing}
                className="btn-secondary px-3 py-1.5 text-xs font-semibold inline-flex items-center gap-1.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border-emerald-200"
              >
                <span>{importing ? "Yuklanmoqda..." : "⚡ Asosiy bazaga import & bog'lash"}</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => void handleTriggerSync()}
              disabled={syncing}
              className="btn-primary px-3 py-1.5 text-xs font-semibold inline-flex items-center gap-1.5"
            >
              <span>{syncing ? "Sinxronlanmoqda..." : "🔄 Kollektorni ishga tushirish"}</span>
            </button>
          </div>
        }
      />

      {/* Xizmat holati status paneli */}
      <div className="card p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-gradient-to-r from-slate-50 to-blue-50/40 border border-slate-200">
        <div className="flex items-center gap-3">
          <div className={`w-3.5 h-3.5 rounded-full ${isOnline ? "bg-emerald-500 animate-pulse" : "bg-rose-500"}`} />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-slate-800">Kollektor Xizmati (FastAPI Python)</span>
              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${isOnline ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"}`}>
                {isOnline ? "ONLINE (Port 8000)" : "OFFLINE"}
              </span>
            </div>
            <p className="text-xs text-slate-500">
              {isOnline
                ? "Xizmat ishlayapti. Ma'lumotlarni yangilash uchun «Kollektorni ishga tushirish» tugmasidan foydalaning."
                : "Kollektor xizmati ishga tushmagan. Administratorga murojaat qiling."}
            </p>
          </div>
        </div>
        <div className="text-xs text-slate-500">
          Ulanish: <code className="font-mono bg-white px-2 py-0.5 rounded border border-slate-200">http://127.0.0.1:8000</code>
        </div>
      </div>

      {brokenSources.length > 0 && (
        <Alert tone="error">
          <div className="space-y-1">
            <p className="font-semibold">
              Quyidagi manbalarda sessiya muddati tugagan — yangi ma&apos;lumot kelmayapti:
            </p>
            <ul className="list-disc space-y-0.5 pl-5">
              {brokenSources.map((log) => (
                <li key={log.source}>
                  <span className="font-medium">{log.source}</span>
                  {log.error ? ` — ${log.error}` : ""}
                </li>
              ))}
            </ul>
            <p>Qayta ulash: Sozlamalar → Tashqi tizimlar bo&apos;limidan foydalaning.</p>
          </div>
        </Alert>
      )}

      {message && (
        <Alert tone={message.type === "success" ? "success" : "error"}>
          {message.text}
        </Alert>
      )}

      {/* KPI Kartochkalari */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Jami yozuvlar"
          value={summary?.total_records ?? 0}
          hint="Barcha manbalardan yig'ilgan yozuvlar"
          tone="blue"
        />
        <StatCard
          label="Avtomobillar"
          value={summary?.total_vehicles ?? 0}
          hint="Aniqlangan davlat raqamlari soni"
          tone="emerald"
        />
        <StatCard
          label="Ijara shartnomalari"
          value={summary?.by_source?.["ijara_soliq"] ?? 0}
          hint="ijara.soliq.uz portali orqali"
          tone="amber"
        />
        <StatCard
          label="Litsenziya & Tenderlar"
          value={(summary?.by_source?.["etender"] ?? 0) + (summary?.by_source?.["bm_dtransport"] ?? 0)}
          hint="e-tender va bm.dtransport ma'lumotlari"
          tone="violet"
        />
      </div>

      {/* Filtrlar va qidiruv */}
      <div className="card p-4 space-y-3 sm:space-y-0 sm:flex sm:items-center sm:justify-between gap-4">
        <div className="flex-1 max-w-md">
          <input
            type="text"
            placeholder="Davlat raqami, haydovchi FIO yoki shartnoma raqami bo'yicha qidiruv..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input text-xs w-full"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="input text-xs py-1.5"
          >
            <option value="">Barcha manbalar</option>
            <option value="ijara_soliq">📑 ijara.soliq.uz</option>
            <option value="etender">📜 e-tender.uztrans.uz</option>
            <option value="bm_dtransport">🚌 bm.dtransport.uz</option>
          </select>

          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="input text-xs py-1.5"
          >
            <option value="">Barcha turlar</option>
            <option value="RENT_CONTRACT">Ijara shartnomalari</option>
            <option value="CAR">Avtomobillar</option>
            <option value="CONTRACT">Litsenziyalar</option>
            <option value="DRIVER">Haydovchilar</option>
          </select>
        </div>
      </div>

      {/* Yozuvlar jadvali */}
      {loadingRecords ? (
        <Loading label="Kollektor ma'lumotlari yuklanmoqda..." />
      ) : records.length === 0 ? (
        <EmptyState>
          Kollektorda yozuvlar topilmadi. Yuqoridagi &quot;Kollektorni ishga tushirish&quot; tugmasini bosing yoki qidiruv filtrini tozalang.
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Manba</th>
                <th>Turi</th>
                <th>Davlat raqami</th>
                <th>Sarlavha</th>
                <th>Tomonlar</th>
                <th>Summa</th>
                <th>Holat</th>
                <th className="text-right">Amallar</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => {
                const lessor = r.parties?.lessor_name || r.parties?.organization_name || "";
                const lessee = r.parties?.lessee_name || r.parties?.driver_name || "";
                const partiesText = [lessor, lessee].filter(Boolean).join(" → ") || "—";

                const sourceBadge =
                  r.source === "ijara_soliq"
                    ? "bg-amber-50 text-amber-800 border-amber-200"
                    : r.source === "etender"
                      ? "bg-blue-50 text-blue-800 border-blue-200"
                      : "bg-emerald-50 text-emerald-800 border-emerald-200";

                const sourceLabel =
                  r.source === "ijara_soliq"
                    ? "ijara.soliq"
                    : r.source === "etender"
                      ? "e-tender"
                      : "bm.dtransport";

                return (
                  <tr key={r.id} className="hover:bg-slate-50/70 transition-colors">
                    <td>
                      <span className={`inline-block border px-2 py-0.5 rounded text-[11px] font-semibold ${sourceBadge}`}>
                        {sourceLabel}
                      </span>
                    </td>
                    <td className="text-xs text-slate-500 font-medium">{r.record_type}</td>
                    <td>
                      <span className="font-mono font-bold text-slate-900">
                        {r.identifier || "—"}
                      </span>
                    </td>
                    <td className="max-w-xs truncate text-xs text-slate-800" title={r.title || ""}>
                      {r.title || "—"}
                    </td>
                    <td className="max-w-xs truncate text-xs text-slate-600" title={partiesText}>
                      {partiesText}
                    </td>
                    <td className="text-xs font-semibold text-slate-800">
                      {r.amount > 0 ? `${r.amount.toLocaleString()} so'm` : "—"}
                    </td>
                    <td>
                      <StatusBadge status={r.status} label={r.status} />
                    </td>
                    <td className="text-right">
                      <button
                        type="button"
                        onClick={() => setSelectedRecord(r)}
                        className="text-xs font-semibold text-brand-600 hover:text-brand-800"
                      >
                        Batafsil
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Batafsil Ko'rish Modali */}
      {selectedRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="card w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden bg-white shadow-2xl">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-800">
                  {selectedRecord.title || `Yozuv #${selectedRecord.id}`}
                </h3>
                <p className="text-xs text-slate-500">
                  ID: {selectedRecord.external_id} • Manba: {selectedRecord.source}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedRecord(null)}
                className="text-slate-400 hover:text-slate-600 text-lg"
              >
                ✕
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200">
                <div>
                  <span className="text-slate-500">Davlat raqami:</span>
                  <p className="font-mono font-bold text-slate-900 text-sm mt-0.5">
                    {selectedRecord.identifier || "—"}
                  </p>
                </div>
                <div>
                  <span className="text-slate-500">Holat:</span>
                  <div className="mt-0.5">
                    <StatusBadge status={selectedRecord.status} label={selectedRecord.status} />
                  </div>
                </div>
                <div>
                  <span className="text-slate-500">Ijaraga beruvchi:</span>
                  <p className="font-medium text-slate-800 mt-0.5">
                    {selectedRecord.parties?.lessor_name || "—"}
                  </p>
                  {selectedRecord.parties?.lessor_phone && (
                    <p className="text-[11px] text-slate-500">Tel: {selectedRecord.parties.lessor_phone}</p>
                  )}
                  {selectedRecord.parties?.lessor_id && (
                    <p className="font-mono text-[11px] text-slate-500">JSHSHIR: {selectedRecord.parties.lessor_id}</p>
                  )}
                </div>
                <div>
                  <span className="text-slate-500">Ijaraga oluvchi (Kompaniya):</span>
                  <p className="font-medium text-slate-800 mt-0.5">
                    {selectedRecord.parties?.lessee_name || "—"}
                  </p>
                </div>
                <div>
                  <span className="text-slate-500">Oylik ijara to'lovi:</span>
                  <p className="font-semibold text-emerald-700 text-sm mt-0.5">
                    {selectedRecord.amount > 0 ? `${selectedRecord.amount.toLocaleString()} so'm/oy` : "Bepul (0 so'm)"}
                  </p>
                </div>
                <div>
                  <span className="text-slate-500">Muddat:</span>
                  <p className="text-slate-700 mt-0.5">
                    {selectedRecord.starts_at || "—"} — {selectedRecord.ends_at || "—"}
                  </p>
                </div>
              </div>

              {selectedRecord.raw_data?.contractViewUrl && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-center justify-between">
                  <div>
                    <span className="font-semibold text-blue-900">ijara.soliq.uz rasmiy sahifasi</span>
                    <p className="text-[11px] text-blue-700">Davlat Soliq Qo&apos;mitasi portalida shartnomani tekshirish</p>
                  </div>
                  <a
                    href={selectedRecord.raw_data.contractViewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-primary text-xs px-3 py-1.5 inline-flex items-center gap-1"
                  >
                    <span>Ochish</span>
                    <span>↗</span>
                  </a>
                </div>
              )}

              <div>
                <span className="font-semibold text-slate-700">Xom ma&apos;lumotlar (JSON):</span>
                <pre className="mt-1 p-3 bg-slate-900 text-slate-100 rounded-lg text-[11px] font-mono overflow-x-auto max-h-56">
                  {JSON.stringify(selectedRecord.raw_data || selectedRecord, null, 2)}
                </pre>
              </div>
            </div>

            <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedRecord(null)}
                className="btn-secondary px-4 py-1.5 text-xs font-semibold"
              >
                Yopish
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
