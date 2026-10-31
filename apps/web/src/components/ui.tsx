"use client";

import type { ReactNode } from "react";

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

const toneByStatus: Record<string, string> = {
  ACTIVE: "bg-emerald-50 text-emerald-700",
  PAID: "bg-emerald-50 text-emerald-700",
  APPROVED: "bg-emerald-50 text-emerald-700",
  REJECTED: "bg-red-50 text-red-700",
  LOW: "bg-emerald-50 text-emerald-700",
  MEDIUM: "bg-amber-50 text-amber-700",
  HIGH: "bg-red-50 text-red-700",
  UPLOADED: "bg-emerald-50 text-emerald-700",
  PROCESSED: "bg-emerald-50 text-emerald-700",
  PENDING: "bg-amber-50 text-amber-700",
  OPEN: "bg-blue-50 text-blue-700",
  DRAFT: "bg-slate-100 text-slate-600",
  TRIAL: "bg-violet-50 text-violet-700",
  MAINTENANCE: "bg-amber-50 text-amber-700",
  OVERDUE: "bg-red-50 text-red-700",
  FAILED: "bg-red-50 text-red-700",
  TERMINATED: "bg-red-50 text-red-700",
  CANCELLED: "bg-slate-100 text-slate-500",
  INACTIVE: "bg-slate-100 text-slate-500",
  PAST_DUE: "bg-red-50 text-red-700",
  RECEIVED: "bg-blue-50 text-blue-700",
  SUCCESS: "bg-emerald-50 text-emerald-700",
  RUNNING: "bg-blue-50 text-blue-700",
};

export function StatusBadge({ status, label }: { status: string; label: string }) {
  return (
    <span className={`badge ${toneByStatus[status] ?? "bg-slate-100 text-slate-600"}`}>
      {label}
    </span>
  );
}

export function Alert({ tone, children }: { tone: "error" | "success"; children: ReactNode }) {
  return (
    <div className={tone === "error" ? "alert-error" : "alert-success"} role="alert">
      {children}
    </div>
  );
}

export function Loading({ label = "Yuklanmoqda..." }: { label?: string }) {
  return (
    <div className="flex items-center justify-center py-16 text-sm text-slate-500">
      <span className="mr-3 h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-brand-600" />
      {label}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="py-12 text-center text-sm text-slate-500">{children}</div>
  );
}

const statTones = {
  blue: "from-brand-500 to-sky-400",
  emerald: "from-emerald-500 to-teal-400",
  violet: "from-violet-500 to-fuchsia-400",
  amber: "from-amber-500 to-orange-400",
  red: "from-red-500 to-rose-400",
} as const;

export function StatCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: keyof typeof statTones;
}) {
  return (
    <div className="card card-body relative overflow-hidden">
      {tone && (
        <span
          aria-hidden
          className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${statTones[tone]}`}
        />
      )}
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-bold tracking-tight text-slate-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}
