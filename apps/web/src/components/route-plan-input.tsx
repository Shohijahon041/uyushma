"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { apiRequest } from "@/lib/client-api";

const MONEY = /^\d{1,16}(\.\d{1,2})?$/;

export function normalizeMoneyInput(raw: string): string {
  return raw.replace(/[\s\u00a0]/g, "").replace(",", ".");
}

export function RoutePlanInput({
  routeId,
  value,
  onSaved,
}: {
  routeId: string;
  value: string;
  onSaved: (affectedPlans: number) => Promise<void> | void;
}) {
  const t = useTranslations("routes");
  const tc = useTranslations("common");
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setDraft(value), [value]);

  const normalized = normalizeMoneyInput(draft) || "0";
  const dirty = Number(normalized) !== Number(value);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!MONEY.test(normalized)) {
      setError(t("planInvalid"));
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const result = await apiRequest<{ affectedPlans: number }>(`/routes/${routeId}`, {
        method: "PATCH",
        body: { monthlyPlan: normalized },
      });
      await onSaved(result.affectedPlans ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : tc("error"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="flex items-center gap-1.5">
      <input
        className="input w-36 px-2 py-1 text-xs"
        inputMode="decimal"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        aria-label={t("monthlyPlan")}
        placeholder="0"
        maxLength={22}
      />
      <button type="submit" className="btn-ghost px-2 py-1 text-xs" disabled={saving || !dirty}>
        {saving ? "..." : tc("save")}
      </button>
      {error && <span className="text-[11px] text-red-600">{error}</span>}
    </form>
  );
}
