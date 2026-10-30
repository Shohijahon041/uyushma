"use client";

import { useLocale } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";

export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const next = locale === "uz" ? "ru" : "uz";

  return (
    <button
      type="button"
      onClick={() => router.replace(pathname, { locale: next })}
      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
      aria-label="Tilni almashtirish"
    >
      <span className={locale === "uz" ? "text-brand-700" : "text-slate-400"}>UZ</span>
      <span className="text-slate-300">/</span>
      <span className={locale === "ru" ? "text-brand-700" : "text-slate-400"}>RU</span>
      {!compact && <span className="sr-only">Til</span>}
    </button>
  );
}
