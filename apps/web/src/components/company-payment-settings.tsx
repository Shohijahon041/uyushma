"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { apiRequest } from "@/lib/client-api";
import { useApi } from "@/lib/use-api";
import type { CompanyPaymentDetails } from "@/lib/types";
import { Alert, StatusBadge } from "@/components/ui";

export function CompanyPaymentSettings({ role }: { role: string }) {
  const tc = useTranslations("common");
  const config = useApi<CompanyPaymentDetails>("/submissions/company-payment-info");
  const [cardNumber, setCardNumber] = useState("");
  const [cardHolder, setCardHolder] = useState("");
  const [cardBank, setCardBank] = useState("");
  const [instructions, setInstructions] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const canEdit = role === "OWNER" || role === "ADMIN" || role === "ACCOUNTANT";

  useEffect(() => {
    if (config.data) {
      setCardNumber(config.data.paymentCardNumber ?? "");
      setCardHolder(config.data.paymentCardHolder ?? "");
      setCardBank(config.data.paymentCardBank ?? "");
      setInstructions(config.data.paymentInstructions ?? "");
    }
  }, [config.data]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    setBusy(true);
    try {
      await apiRequest("/submissions/company-payment-info", {
        method: "PUT",
        body: {
          paymentCardNumber: cardNumber.replace(/\s+/g, "").trim() || undefined,
          paymentCardHolder: cardHolder.trim() || undefined,
          paymentCardBank: cardBank.trim() || undefined,
          paymentInstructions: instructions.trim() || undefined,
        },
      });
      setSaved(true);
      await config.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : tc("error"));
    } finally {
      setBusy(false);
    }
  }

  const isConfigured = Boolean(config.data?.paymentCardNumber);

  return (
    <div className="card card-body">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-bold text-slate-800">
            Masofaviy to&apos;lov kartasi (Karta rekvizitlari)
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            Haydovchilar Telegram bot orqali masofadan to&apos;lov qilishi uchun kompaniya qabul qiluvchi karta ma&apos;lumotlari.
          </p>
        </div>
        <StatusBadge
          status={isConfigured ? "ACTIVE" : "INACTIVE"}
          label={isConfigured ? "Karta kiritilgan" : "Kiritilmagan"}
        />
      </div>

      {error && (
        <div className="mt-4">
          <Alert tone="error">{error}</Alert>
        </div>
      )}
      {saved && (
        <div className="mt-4">
          <Alert tone="success">Karta ma&apos;lumotlari muvaffaqiyatli saqlandi.</Alert>
        </div>
      )}

      {canEdit ? (
        <form onSubmit={onSubmit} className="mt-4 space-y-3">
          <div>
            <label className="label" htmlFor="card-number">
              Karta raqami (16 ta raqam)
            </label>
            <input
              id="card-number"
              type="text"
              className="input font-mono"
              placeholder="8600 1234 5678 9012"
              value={cardNumber}
              onChange={(e) => setCardNumber(e.target.value)}
              required
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="card-holder">
                Karta egasi (F.I.SH. yoki korxona)
              </label>
              <input
                id="card-holder"
                type="text"
                className="input"
                placeholder="Falonchiyev Falonchi"
                value={cardHolder}
                onChange={(e) => setCardHolder(e.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="card-bank">
                Bank nomi
              </label>
              <input
                id="card-bank"
                type="text"
                className="input"
                placeholder="Kapitalbank, Ipak Yo'li va h.k."
                value={cardBank}
                onChange={(e) => setCardBank(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="label" htmlFor="card-instructions">
              Haydovchilar uchun ko&apos;rsatma / izoh
            </label>
            <textarea
              id="card-instructions"
              className="input text-xs"
              rows={2}
              placeholder="To'lov izohiga davlat raqamingizni yozing va chek skrinshotini yuboring."
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
            />
          </div>

          <div className="pt-2">
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? "Saqlanmoqda..." : "Saqlash"}
            </button>
          </div>
        </form>
      ) : (
        <div className="mt-4 text-xs text-slate-500">
          Ushbu ma&apos;lumotlarni faqat Korxona rahbari yoki hisobchisi o&apos;zgartirishi mumkin.
        </div>
      )}
    </div>
  );
}

