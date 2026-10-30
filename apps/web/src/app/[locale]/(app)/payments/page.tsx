"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { apiRequest } from "@/lib/client-api";
import { formatDate, formatMoney, useApi } from "@/lib/use-api";
import type { Contract, Payment } from "@/lib/types";
import { Alert, EmptyState, Loading, PageHeader, StatusBadge } from "@/components/ui";

interface PaymentCreateResponse {
  payment: Payment;
  idempotentReplay: boolean;
}

export default function PaymentsPage() {
  const t = useTranslations("payments");
  const tc = useTranslations("common");
  const { data, loading, error, reload } = useApi<{ items: Payment[] }>("/payments");
  const contracts = useApi<{ items: Contract[] }>("/contracts");

  const [contractId, setContractId] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"MANUAL" | "AUTOMATIC">("MANUAL");
  const [description, setDescription] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const idempotencyKey = useRef<string>(
    typeof crypto !== "undefined" ? crypto.randomUUID() : "web-fallback-key-0001",
  );

  const activeContracts = contracts.data?.items.filter(
    (contract) => contract.status === "ACTIVE",
  );

  useEffect(() => {
    if (!contractId && activeContracts?.[0]) {
      setContractId(activeContracts[0].id);
    }
  }, [activeContracts, contractId]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setSaving(true);
    try {
      const result = await apiRequest<PaymentCreateResponse>("/payments", {
        method: "POST",
        body: {
          contractId,
          amount,
          method,
          ...(description ? { description } : {}),
        },
        headers: { "Idempotency-Key": idempotencyKey.current },
      });
      idempotencyKey.current = crypto.randomUUID();
      setAmount("");
      setDescription("");
      await reload();
      if (result.idempotentReplay) {
        setActionError("Takroriy so'rov aniqlandi — mavjud to'lov qaytarildi.");
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : tc("error"));
    } finally {
      setSaving(false);
    }
  }

  async function markPaid(payment: Payment) {
    setActionError(null);
    try {
      await apiRequest(`/payments/${payment.id}/mark-paid`, {
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
        <p className="mb-4 text-xs text-slate-500">{t("idempotent")}</p>
        <form onSubmit={onSubmit} className="space-y-4">
          {(formError || actionError) && <Alert tone="error">{formError ?? actionError}</Alert>}
          <div className="form-grid">
            <div>
              <label className="label" htmlFor="payment-contract">
                {t("contract")}
              </label>
              <select
                id="payment-contract"
                className="select"
                value={contractId}
                onChange={(event) => setContractId(event.target.value)}
                required
              >
                {activeContracts?.length ? (
                  activeContracts.map((contract) => (
                    <option key={contract.id} value={contract.id}>
                      {contract.vehicle.plateNumber} — {contract.owner.fullName}
                    </option>
                  ))
                ) : (
                  <option value="">Faol shartnoma yo'q</option>
                )}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="payment-amount">
                {t("amount")}
              </label>
              <input
                id="payment-amount"
                className="input"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="1250000.00"
                pattern="^\d{1,16}(\.\d{1,2})?$"
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="payment-method">
                {t("method")}
              </label>
              <select
                id="payment-method"
                className="select"
                value={method}
                onChange={(event) => setMethod(event.target.value as typeof method)}
              >
                <option value="MANUAL">{t("MANUAL")}</option>
                <option value="AUTOMATIC">{t("AUTOMATIC")}</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="payment-description">
                {t("description")}
              </label>
              <input
                id="payment-description"
                className="input"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
          </div>
          <button
            type="submit"
            className="btn-primary"
            disabled={saving || !contractId}
          >
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
                  <th>{tc("date")}</th>
                  <th>{t("plate")}</th>
                  <th>{t("owner")}</th>
                  <th>{t("amount")}</th>
                  <th>{t("method")}</th>
                  <th>{tc("status")}</th>
                  <th>{tc("actions")}</th>
                </tr>
              </thead>
              <tbody>
                {data?.items.map((payment) => (
                  <tr key={payment.id}>
                    <td className="whitespace-nowrap text-slate-500">
                      {formatDate(payment.createdAt)}
                    </td>
                    <td className="font-mono font-semibold text-slate-900">
                      {payment.contract.vehicle.plateNumber}
                    </td>
                    <td>{payment.contract.owner.fullName}</td>
                    <td className="whitespace-nowrap font-semibold">
                      {formatMoney(payment.amount)}
                    </td>
                    <td>{t(payment.method)}</td>
                    <td>
                      <StatusBadge status={payment.status} label={t(payment.status)} />
                    </td>
                    <td>
                      {payment.status === "PENDING" && (
                        <button
                          type="button"
                          className="btn-ghost text-xs text-emerald-700"
                          onClick={() => void markPaid(payment)}
                        >
                          {t("markPaid")}
                        </button>
                      )}
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
