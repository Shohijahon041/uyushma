"use client";

import { useEffect, useState } from "react";
import { Icon } from "./icons";

export const THEME_STORAGE_KEY = "uyushma-theme";

export function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    document.documentElement.style.colorScheme = next ? "dark" : "light";
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next ? "dark" : "light");
    } catch {
      // private mode: theme simply won't persist
    }
    setDark(next);
  }

  const label = dark ? "Kunduzgi rejim" : "Tungi rejim";
  return (
    <button
      type="button"
      onClick={toggle}
      className="rounded-xl border border-slate-200 bg-white p-2 text-slate-500 transition hover:bg-slate-50 hover:text-slate-700"
      aria-label={label}
      title={label}
    >
      <Icon name={dark ? "sun" : "moon"} className="h-4 w-4" />
    </button>
  );
}
