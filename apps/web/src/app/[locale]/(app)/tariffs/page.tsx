"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { apiRequest } from "@/lib/client-api";
import { useApi } from "@/lib/use-api";
import type { CalculationResult, RouteItem, Tariff } from "@/lib/types";
import { Alert, EmptyState, Loading, PageHeader, StatusBadge } from "@/components/ui";
import { formatMoney } from "@/lib/use-api";

interface RuleForm {
  code: string;
  label: string;
  operation: "ADD" | "OVERRIDE";
  amount: string;
  priority: number;
}

const EMPTY_RULE: RuleForm = {
  code: "",
  label: "",
  operation: "ADD",
  amount: "0.00",
  priority: 10,
};

export default function TariffsPage() {
  const t = useTranslations("tariffs");
  const tc = useTranslations("common");
  const { data, loading, error, reload } = useApi<{ items: Tariff[] }>("/tariffs");
  const routes = useApi<{ items: RouteItem[] }>("/routes");

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [scope, setScope] = useState<"STANDARD" | "ROUTE" | "INDIVIDUAL">("STANDARD");
  const [routeId, setRouteId] = useState("");
  const [baseAmount, setBaseAmount] = useState("0.00");
  const [pricePerKm, setPricePerKm] = useState("0.00");
  const [rules, setRules] = useState<RuleForm[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [calculation, setCalculation] = useState<CalculationResult | null>(null);

  function updateRule(index: number, patch: Partial<RuleForm>) {
    setRules((current) =>
      current.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)),
    );
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setSaving(true);
    try {
      await apiRequest<Tariff>("/tariffs", {
        method: "POST",
        body: {
          name,
          ...(description ? { description } : {}),
          scope,
          ...(scope === "ROUTE" ? { routeId } : {}),
          baseAmount,
          pricePerKm,
          rules: rules.map((rule) => ({
            ...rule,
            code: rule.code.toUpperCase(),
          })),
        },
      });
      setName("");
      setDescription("");
      setBaseAmount("0.00");
      setPricePerKm("0.00");
      setRules([]);
      await reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : tc("error"));
    } finally {
      setSaving(false);
    }
  }

  async function toggle(tariff: Tariff) {
    setActionError(null);
    try {
      await apiRequest(`/tariffs/${tariff.id}/status`, {
        method: "PATCH",
        body: { isActive: !tariff.isActive },
      });
      await reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : tc("error"));
    }
  }

  async function calculate(tariff: Tariff) {
    setActionError(null);
    setCalculation(null);
    try {
      const result = await apiRequest<CalculationResult>(
        `/tariffs/${tariff.id}/calculate`,
        { method: "POST", body: {} },
      );
      setCalculation(result);
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
            <div>
              <label className="label" htmlFor="tariff-name">
                {t("name")}
              </label>
              <input
                id="tariff-name"
                className="input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="scope">
                {t("scope")}
              </label>
              <select
                id="scope"
                className="select"
                value={scope}
                onChange={(event) => setScope(event.target.value as typeof scope)}
              >
                <option value="STANDARD">{t("STANDARD")}</option>
                <option value="ROUTE">{t("ROUTE")}</option>
                <option value="INDIVIDUAL">{t("INDIVIDUAL")}</option>
              </select>
            </div>
            {scope === "ROUTE" && (
              <div>
                <label className="label" htmlFor="tariff-route">
                  {t("route")}
                </label>
                <select
                  id="tariff-route"
                  className="select"
                  value={routeId}
                  onChange={(event) => setRouteId(event.target.value)}
                  required
                >
                  <option value="">—</option>
                  {routes.data?.items
                    .filter((route) => route.isActive)
                    .map((route) => (
                      <option key={route.id} value={route.id}>
                        {route.name} ({route.distanceKm} km)
                      </option>
                    ))}
                </select>
              </div>
            )}
            <div>
              <label className="label" htmlFor="base-amount">
                {t("baseAmount")}
              </label>
              <input
                id="base-amount"
                className="input"
                inputMode="decimal"
                value={baseAmount}
                onChange={(event) => setBaseAmount(event.target.value)}
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="price-km">
                {t("pricePerKm")}
              </label>
              <input
                id="price-km"
                className="input"
                inputMode="decimal"
                value={pricePerKm}
                onChange={(event) => setPricePerKm(event.target.value)}
                required
              />
            </div>
            <div className="field-full">
              <label className="label" htmlFor="tariff-description">
                {t("description")}
              </label>
              <input
                id="tariff-description"
                className="input"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-800">{t("rules")}</h3>
              <button
                type="button"
                className="btn-secondary px-3 py-1.5 text-xs"
                onClick={() => setRules((current) => [...current, { ...EMPTY_RULE }])}
              >
                + {t("addRule")}
              </button>
            </div>
            {rules.length === 0 && (
              <p className="mt-3 text-xs text-slate-500">
                ADD qo'shimcha undirish, OVERRIDE esa avvalgi hisobni almashtiradi.
              </p>
            )}
            <div className="mt-3 space-y-3">
              {rules.map((rule, index) => (
                <div key={index} className="grid gap-2 sm:grid-cols-6">
                  <input
                    className="input sm:col-span-1"
                    placeholder={t("ruleCode")}
                    value={rule.code}
                    onChange={(event) =>
                      updateRule(index, { code: event.target.value.toUpperCase() })
                    }
                    required
                  />
                  <input
                    className="input sm:col-span-2"
                    placeholder={t("ruleLabel")}
                    value={rule.label}
                    onChange={(event) => updateRule(index, { label: event.target.value })}
                    required
                  />
                  <select
                    className="select sm:col-span-1"
                    value={rule.operation}
                    onChange={(event) =>
                      updateRule(index, {
                        operation: event.target.value as RuleForm["operation"],
                      })
                    }
                  >
                    <option value="ADD">ADD</option>
                    <option value="OVERRIDE">OVERRIDE</option>
                  </select>
                  <input
                    className="input sm:col-span-1"
                    inputMode="decimal"
                    value={rule.amount}
                    onChange={(event) => updateRule(index, { amount: event.target.value })}
                    required
                  />
                  <div className="flex gap-1.5">
                    <input
                      type="number"
                      className="input"
                      value={rule.priority}
                      onChange={(event) =>
                        updateRule(index, { priority: Number(event.target.value) })
                      }
                      title={t("priority")}
                    />
                    <button
                      type="button"
                      className="btn-ghost text-xs text-red-600"
                      onClick={() =>
                        setRules((current) => current.filter((_, i) => i !== index))
                      }
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <button type="submit" className="btn-primary" disabled={saving}>
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
                  <th>{t("name")}</th>
                  <th>{t("scope")}</th>
                  <th>{t("baseAmount")}</th>
                  <th>{t("pricePerKm")}</th>
                  <th>{t("rules")}</th>
                  <th>{tc("status")}</th>
                  <th>{tc("actions")}</th>
                </tr>
              </thead>
              <tbody>
                {data?.items.map((tariff) => (
                  <tr key={tariff.id}>
                    <td>
                      <p className="font-semibold text-slate-900">{tariff.name}</p>
                      {tariff.route && (
                        <p className="text-xs text-slate-400">{tariff.route.name}</p>
                      )}
                    </td>
                    <td>{t(tariff.scope)}</td>
                    <td>{formatMoney(tariff.baseAmount)}</td>
                    <td>{formatMoney(tariff.pricePerKm)}</td>
                    <td>
                      <div className="flex max-w-xs flex-wrap gap-1">
                        {tariff.rules.length === 0 && <span className="text-slate-400">—</span>}
                        {tariff.rules.map((rule) => (
                          <span
                            key={rule.id}
                            className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600"
                            title={`${rule.operation} ${rule.amount}`}
                          >
                            {rule.code}: {rule.operation === "ADD" ? "+" : "="}
                            {rule.amount}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <StatusBadge
                        status={tariff.isActive ? "ACTIVE" : "INACTIVE"}
                        label={tariff.isActive ? "Faol" : "Faolsiz"}
                      />
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          className="btn-ghost text-xs"
                          onClick={() => void calculate(tariff)}
                        >
                          {t("calculate")}
                        </button>
                        <button
                          type="button"
                          className="btn-ghost text-xs"
                          onClick={() => void toggle(tariff)}
                        >
                          {tariff.isActive ? t("deactivate") : t("activate")}
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

      {calculation && (
        <div className="card card-body mt-5">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-sm font-bold text-slate-800">
                {calculation.tariffName} — {t("calculated")}
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                {t("base")}: {formatMoney(calculation.baseAmount)} · {t("perKm")}:{" "}
                {formatMoney(calculation.pricePerKm)} · {t("distance")}:{" "}
                {calculation.distanceKm} km
              </p>
            </div>
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={() => setCalculation(null)}
            >
              {tc("close")}
            </button>
          </div>
          <p className="mt-4 text-3xl font-bold text-brand-800">{formatMoney(calculation.total)}</p>
          {calculation.lines.length > 0 && (
            <ul className="mt-4 space-y-2 text-sm">
              {calculation.lines.map((line) => (
                <li
                  key={line.code}
                  className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2"
                >
                  <span>
                    <span className="font-mono text-xs font-semibold text-slate-500">
                      {line.code}
                    </span>{" "}
                    {line.label}{" "}
                    <span className="text-xs text-slate-400">
                      ({line.operation === "ADD" ? "+" : "="} {formatMoney(line.amount)})
                    </span>
                  </span>
                  <span className="font-semibold text-slate-800">{formatMoney(line.after)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}
