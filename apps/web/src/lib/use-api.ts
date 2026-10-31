"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest, getCachedApiData } from "./client-api";

export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(() => {
    return path ? getCachedApiData<T>(path) ?? null : null;
  });
  const [loading, setLoading] = useState<boolean>(() => {
    if (!path) return false;
    return getCachedApiData<T>(path) === undefined;
  });
  const [error, setError] = useState<string | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;

  const load = useCallback(
    async (bypassCache = false) => {
      if (!path) {
        setLoading(false);
        return;
      }
      // Agar ma'lumot allaqachon keshda bo'lsa (Stale-While-Revalidate),
      // foydalanuvchiga bo'sh loading ekrani ko'rsatmasdan fonda yangilaymiz.
      const hasExisting = dataRef.current !== null || getCachedApiData<T>(path) !== undefined;
      if (!hasExisting || bypassCache) {
        setLoading(true);
      }
      setError(null);
      try {
        const result = await apiRequest<T>(path, { bypassCache });
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Xatolik");
      } finally {
        setLoading(false);
      }
    },
    [path],
  );

  const reload = useCallback(() => load(true), [load]);

  useEffect(() => {
    if (path) {
      const cached = getCachedApiData<T>(path);
      if (cached !== undefined) {
        setData(cached);
        setLoading(false);
      }
    }
    void load();
  }, [load, path]);

  return { data, loading, error, reload, setData };
}

export function formatMoney(value: string | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const [int, fraction = "00"] = value.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${grouped}.${fraction.padEnd(2, "0")} so'm`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return new Intl.DateTimeFormat("uz-UZ", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("uz-UZ", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
