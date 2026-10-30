"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { apiRequest } from "@/lib/client-api";
import { formatMoney } from "@/lib/use-api";
import { todayTashkent } from "@/lib/tashkent";
import type { DailyBoard, DailyBoardItem } from "@/lib/types";
import { normalizeMoneyInput } from "./route-plan-input";

const MONEY = /^\d{1,16}(\.\d{1,2})?$/;

function remainingOf(item: DailyBoardItem): string {
  return Number(item.month.debt) > 0 ? item.month.debt : "";
}

export function QuickPayButton() {
  const t = useTranslations("quickPay");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "F2") {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <button
        type="button"
        className="btn-primary px-3 py-1.5 text-xs"
        onClick={() => setOpen(true)}
        title={`${t("title")} (F2)`}
      >
        ⚡ {t("button")}
      </button>
      {open && <QuickPayDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function QuickPayDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations("quickPay");
  const td = useTranslations("daily");
  const tc = useTranslations("common");
  const searchRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);

  const [search, setSearch] = useState("");
  const [items, setItems] = useState<DailyBoardItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<DailyBoardItem | null>(null);
  const [active, setActive] = useState(0);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"CASH" | "CARD">("CASH");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const idempotencyKey = useRef<string>(crypto.randomUUID());

  useEffect(() => {
    searchRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (selected) return;
    const query = search.trim();
    if (query.length < 2) {
      setItems([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ date: todayTashkent(), q: query });
        const board = await apiRequest<DailyBoard>(`/billing/daily?${params.toString()}`);
        if (!cancelled) {
          setItems(board.items.slice(0, 8));
          setActive(0);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : tc("error"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search, selected, tc]);

  function choose(item: DailyBoardItem) {
    setSelected(item);
    setAmount(remainingOf(item));
    setMethod("CASH");
    setError(null);
    setDone(null);
    idempotencyKey.current = crypto.randomUUID();
    setTimeout(() => amountRef.current?.select(), 0);
  }

  function reset() {
    setSelected(null);
    setAmount("");
    setSearch("");
    setItems([]);
    setTimeout(() => searchRef.current?.focus(), 0);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const normalized = normalizeMoneyInput(amount);
    if (!MONEY.test(normalized) || Number(normalized) <= 0) {
      setError(t("amountInvalid"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiRequest("/billing/payments", {
        method: "POST",
        body: {
          vehicleId: selected.vehicleId,
          driverId: selected.driver.id,
          amount: normalized,
          method,
          paidAt: todayTashkent(),
        },
        headers: { "Idempotency-Key": idempotencyKey.current },
      });
      setDone(
        t("saved", {
          amount: formatMoney(Number(normalized).toFixed(2)),
          plate: selected.plateNumber,
        }),
      );
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : tc("error"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 p-4 pt-[10vh]"
      role="dialog"
      aria-modal="true"
      aria-label={t("title")}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="card w-full max-w-lg overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-bold text-slate-900">⚡ {t("title")}</h2>
          <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={onClose}>
            {tc("close")} (Esc)
          </button>
        </div>

        <div className="space-y-3 p-4">
          {done && (
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">{done}</p>
          )}
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          {!selected ? (
            <>
              <input
                ref={searchRef}
                className="input"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setActive((index) => Math.min(index + 1, items.length - 1));
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setActive((index) => Math.max(index - 1, 0));
                  } else if (event.key === "Enter" && items[active]) {
                    event.preventDefault();
                    choose(items[active]);
                  }
                }}
                placeholder={td("searchPlaceholder")}
                aria-label={td("searchPlaceholder")}
              />
              {loading && <p className="text-xs text-slate-400">{tc("loading")}</p>}
              {!loading && search.trim().length >= 2 && items.length === 0 && (
                <p className="text-xs text-slate-500">{t("notFound")}</p>
              )}
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100">
                {items.map((item, index) => (
                  <li key={item.vehicleId}>
                    <button
                      type="button"
                      className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm ${
                        index === active ? "bg-brand-50" : "hover:bg-slate-50"
                      }`}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => choose(item)}
                    >
                      <span>
                        <span className="font-mono font-semibold text-slate-900">{item.plateNumber}</span>
                        <span className="ml-2 text-slate-600">{item.driver.fullName}</span>
                        {item.route && (
                          <span className="block text-[11px] text-slate-400">{item.route.name}</span>
                        )}
                      </span>
                      <span className="text-right text-xs">
                        <span className={Number(item.month.debt) > 0 ? "font-semibold text-red-600" : "text-emerald-700"}>
                          {formatMoney(item.month.debt)}
                        </span>
                        <span className="block text-[10px] text-slate-400">{td("debtMonth")}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-slate-400">{t("hint")}</p>
            </>
          ) : (
            <form onSubmit={submit} className="space-y-3">
              <div className="rounded-xl border border-slate-200 p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-mono text-base font-bold text-slate-900">{selected.plateNumber}</p>
                    <p className="text-slate-600">{selected.driver.fullName}</p>
                    <p className="font-mono text-[11px] text-slate-400">{selected.driver.phone}</p>
                  </div>
                  <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={reset}>
                    {t("change")}
                  </button>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <dt className="text-slate-500">{td("plan")}</dt>
                  <dd className="text-right">{formatMoney(selected.month.due)}</dd>
                  <dt className="text-slate-500">{td("paid")}</dt>
                  <dd className="text-right text-emerald-700">{formatMoney(selected.month.paid)}</dd>
                  <dt className="text-slate-500">{td("debtMonth")}</dt>
                  <dd className="text-right font-semibold text-red-600">{formatMoney(selected.month.debt)}</dd>
                  <dt className="text-slate-500">{td("paidToday")}</dt>
                  <dd className="text-right">{formatMoney(selected.paidToday)}</dd>
                </dl>
              </div>

              <div>
                <label className="label" htmlFor="quick-amount">
                  {td("amount")}
                </label>
                <input
                  ref={amountRef}
                  id="quick-amount"
                  className="input text-lg font-semibold"
                  inputMode="decimal"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder="0"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                {(["CASH", "CARD"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={method === option ? "btn-primary" : "btn-secondary"}
                    onClick={() => setMethod(option)}
                    aria-pressed={method === option}
                  >
                    {option === "CASH" ? "💵" : "💳"} {td(option)}
                  </button>
                ))}
              </div>

              <button type="submit" className="btn-primary w-full" disabled={saving}>
                {saving ? td("submitting") : td("submit")}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
