"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/icons";

export default function LiveMapPage() {
  const t = useTranslations("map");
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeKey, setIframeKey] = useState<number>(0);

  const handleRefresh = () => {
    setIframeKey((prev) => prev + 1);
  };

  return (
    <div className="space-y-4">
      {/* Sahifa Sarlavhasi va Boshqaruv Tugmalari */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
              {t("title")}
            </h1>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
              </span>
              {t("statusLive")}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {t("subtitle")}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleRefresh}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 hover:text-slate-900 transition dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <Icon name="sun" className="h-3.5 w-3.5" />
            {t("refreshMap")}
          </button>

          <a
            href="/map"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-brand-700 transition dark:bg-brand-500 dark:hover:bg-brand-600"
          >
            <Icon name="link" className="h-3.5 w-3.5" />
            {t("openFullscreen")} ↗
          </a>
        </div>
      </div>

      {/* Interaktiv Dispetcher Xaritasi Iframe */}
      <div className="relative w-full overflow-hidden rounded-2xl border border-slate-200/80 bg-slate-900 shadow-md dark:border-slate-800">
        <iframe
          key={iframeKey}
          ref={iframeRef}
          src="/map"
          title={t("title")}
          className="h-[calc(100vh-13rem)] min-h-[620px] w-full border-0"
          allow="geolocation; fullscreen"
          loading="lazy"
        />
      </div>
    </div>
  );
}
