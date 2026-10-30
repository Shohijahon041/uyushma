"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { formatDateTime, useApi } from "@/lib/use-api";
import type { AuditItem } from "@/lib/types";
import { Alert, EmptyState, Loading, PageHeader } from "@/components/ui";

export default function AuditPage() {
  const t = useTranslations("audit");
  const tc = useTranslations("common");
  const [entityType, setEntityType] = useState("");
  const [action, setAction] = useState("");
  const [page, setPage] = useState(1);
  const [applied, setApplied] = useState({ entityType: "", action: "" });

  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("pageSize", "25");
  if (applied.entityType) params.set("entityType", applied.entityType);
  if (applied.action) params.set("action", applied.action);
  const { data, loading, error } = useApi<{
    items: AuditItem[];
    total: number;
    page: number;
    pageSize: number;
  }>(`/audit?${params.toString()}`);

  function onFilter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    setApplied({ entityType: entityType.trim(), action: action.trim() });
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <form onSubmit={onFilter} className="card card-body mb-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="label" htmlFor="entity-filter">
              {t("filterEntity")}
            </label>
            <input
              id="entity-filter"
              className="input"
              placeholder="Vehicle, Payment, Contract..."
              value={entityType}
              onChange={(event) => setEntityType(event.target.value)}
            />
          </div>
          <div className="flex-1">
            <label className="label" htmlFor="action-filter">
              {t("filterAction")}
            </label>
            <input
              id="action-filter"
              className="input"
              placeholder="payment.created"
              value={action}
              onChange={(event) => setAction(event.target.value)}
            />
          </div>
          <button type="submit" className="btn-secondary">
            {tc("filters")}
          </button>
        </div>
      </form>

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
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t("time")}</th>
                    <th>{t("action")}</th>
                    <th>{t("entity")}</th>
                    <th>{t("actor")}</th>
                    <th>{t("ip")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.items.map((item) => (
                    <tr key={item.id}>
                      <td className="whitespace-nowrap text-slate-500">
                        {formatDateTime(item.createdAt)}
                      </td>
                      <td>
                        <span className="rounded-md bg-slate-100 px-2 py-1 font-mono text-[11px] font-semibold text-slate-700">
                          {item.action}
                        </span>
                      </td>
                      <td>
                        <p className="text-slate-700">{item.entityType}</p>
                        <p className="max-w-[180px] truncate font-mono text-[10px] text-slate-400">
                          {item.entityId ?? "—"}
                        </p>
                      </td>
                      <td className="text-xs">
                        {item.actorType === "SYSTEM"
                          ? t("system")
                          : item.actorType === "INTEGRATION"
                            ? "Integration"
                            : item.actorUserId
                              ? `${item.actorUserId.slice(0, 8)}…`
                              : "—"}
                      </td>
                      <td className="font-mono text-xs text-slate-400">{item.ip ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
              <span>
                {data?.total} yozuv · {data?.page}/{totalPages}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-secondary px-3 py-1.5 text-xs"
                  disabled={page <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  ←
                </button>
                <button
                  type="button"
                  className="btn-secondary px-3 py-1.5 text-xs"
                  disabled={page >= totalPages}
                  onClick={() => setPage((current) => current + 1)}
                >
                  →
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
