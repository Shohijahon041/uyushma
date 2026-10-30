"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { apiRequest } from "@/lib/client-api";
import { useApi } from "@/lib/use-api";
import type { RouteItem } from "@/lib/types";
import { Alert, EmptyState, Loading, PageHeader, StatusBadge } from "@/components/ui";
import { RoutePlanInput, normalizeMoneyInput } from "@/components/route-plan-input";

/**
 * Directions imported from e-tender come without a distance, so the cell turns
 * into a one-field form until the company fills the real kilometrage in.
 */
function DistanceCell({
  route,
  onSaved,
}: {
  route: RouteItem;
  onSaved: () => Promise<void>;
}) {
  const t = useTranslations("routes");
  const tc = useTranslations("common");
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (route.distanceKm !== "0.00") return <span>{route.distanceKm}</span>;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = value.replace(",", ".").trim();
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError(t("distanceRequired"));
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await apiRequest(`/routes/${route.id}`, {
        method: "PATCH",
        body: { distanceKm: normalized },
      });
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : tc("error"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="flex items-center gap-1.5">
      <input
        className="input w-20 px-2 py-1 text-xs"
        inputMode="decimal"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="km"
        maxLength={10}
        required
      />
      <button type="submit" className="btn-ghost text-xs" disabled={saving}>
        {saving ? "..." : t("save")}
      </button>
      {error && (
        <span className="text-[10px] text-red-600" title={error}>
          !
        </span>
      )}
    </form>
  );
}

export default function RoutesPage() {
  const t = useTranslations("routes");
  const tc = useTranslations("common");
  const { data, loading, error, reload } = useApi<{ items: RouteItem[] }>("/routes");

  const [name, setName] = useState("");
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [distanceKm, setDistanceKm] = useState("");
  const [monthlyPlan, setMonthlyPlan] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setSaving(true);
    try {
      await apiRequest<RouteItem>("/routes", {
        method: "POST",
        body: {
          name,
          origin,
          destination,
          distanceKm,
          ...(monthlyPlan.trim() ? { monthlyPlan: normalizeMoneyInput(monthlyPlan) } : {}),
        },
      });
      setName("");
      setOrigin("");
      setDestination("");
      setDistanceKm("");
      setMonthlyPlan("");
      await reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : tc("error"));
    } finally {
      setSaving(false);
    }
  }

  async function toggle(route: RouteItem) {
    setActionError(null);
    try {
      await apiRequest(`/routes/${route.id}`, {
        method: "PATCH",
        body: { isActive: !route.isActive },
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
        <h2 className="mb-4 text-sm font-bold text-slate-800">{t("addTitle")}</h2>
        <form onSubmit={onSubmit} className="space-y-4">
          {(formError || actionError) && <Alert tone="error">{formError ?? actionError}</Alert>}
          <div className="form-grid">
            <div className="field-full">
              <label className="label" htmlFor="route-name">
                {t("name")}
              </label>
              <input
                id="route-name"
                className="input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Toshkent — Samarqand"
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="origin">
                {t("origin")}
              </label>
              <input
                id="origin"
                className="input"
                value={origin}
                onChange={(event) => setOrigin(event.target.value)}
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="destination">
                {t("destination")}
              </label>
              <input
                id="destination"
                className="input"
                value={destination}
                onChange={(event) => setDestination(event.target.value)}
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="distance">
                {t("distanceKm")}
              </label>
              <input
                id="distance"
                className="input"
                inputMode="decimal"
                value={distanceKm}
                onChange={(event) => setDistanceKm(event.target.value)}
                placeholder="300.50"
                pattern="^\d{1,8}(\.\d{1,2})?$"
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="monthly-plan">
                {t("monthlyPlan")}
              </label>
              <input
                id="monthly-plan"
                className="input"
                inputMode="decimal"
                value={monthlyPlan}
                onChange={(event) => setMonthlyPlan(event.target.value)}
                placeholder="1 500 000"
              />
            </div>
          </div>
          <p className="text-xs text-slate-500">{t("monthlyPlanHint")}</p>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? t("creating") : t("create")}
          </button>
        </form>
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
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("name")}</th>
                  <th>{t("origin")}</th>
                  <th>{t("destination")}</th>
                  <th>{t("distanceKm")}</th>
                  <th>{t("monthlyPlan")}</th>
                  <th>{t("vehicles")}</th>
                  <th>{t("tariffs")}</th>
                  <th>{tc("status")}</th>
                  <th>{tc("actions")}</th>
                </tr>
              </thead>
              <tbody>
                {data?.items.map((route) => (
                  <tr key={route.id}>
                    <td className="font-semibold text-slate-900">{route.name}</td>
                    <td>{route.origin || "—"}</td>
                    <td>{route.destination || "—"}</td>
                    <td>
                      <DistanceCell route={route} onSaved={reload} />
                    </td>
                    <td>
                      <RoutePlanInput
                        routeId={route.id}
                        value={route.monthlyPlan}
                        onSaved={async (count) => {
                          setNotice(t("planSaved", { count }));
                          await reload();
                        }}
                      />
                    </td>
                    <td>{route._count.vehicles}</td>
                    <td>{route._count.tariffs}</td>
                    <td>
                      <StatusBadge
                        status={route.isActive ? "ACTIVE" : "INACTIVE"}
                        label={route.isActive ? "Faol" : t("inactive")}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn-ghost text-xs"
                        onClick={() => void toggle(route)}
                      >
                        {route.isActive ? t("deactivate") : t("activate")}
                      </button>
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
