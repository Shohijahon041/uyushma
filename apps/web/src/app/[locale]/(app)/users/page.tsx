"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { apiRequest } from "@/lib/client-api";
import { formatDateTime, useApi } from "@/lib/use-api";
import type { AuthUser, UserItem } from "@/lib/types";
import { Alert, EmptyState, Loading, PageHeader, StatusBadge } from "@/components/ui";

type Role = "OWNER" | "ADMIN" | "ACCOUNTANT" | "MANAGER";

interface IssuedLogin {
  fullName: string;
  phone: string;
  password: string;
}

interface UserWithPassword {
  user: { fullName: string; phone: string | null };
  password: string;
}

export default function UsersPage() {
  const t = useTranslations("users");
  const tc = useTranslations("common");
  const { data, loading, error, reload } = useApi<{ items: UserItem[] }>("/users");
  const me = useApi<AuthUser>("/auth/me");

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("+998 ");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("MANAGER");
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [issued, setIssued] = useState<IssuedLogin | null>(null);
  const [copied, setCopied] = useState(false);

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");

  const filteredUsers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return (data?.items ?? []).filter((u) => {
      if (roleFilter && u.role !== roleFilter) return false;
      if (statusFilter === "ACTIVE" && !u.isActive) return false;
      if (statusFilter === "INACTIVE" && u.isActive) return false;
      if (!q) return true;
      return (
        u.fullName.toLowerCase().includes(q) ||
        (u.phone && u.phone.toLowerCase().includes(q))
      );
    });
  }, [data?.items, searchQuery, roleFilter, statusFilter]);

  const roleOptions: Role[] =
    me.data?.role === "OWNER"
      ? ["OWNER", "ADMIN", "ACCOUNTANT", "MANAGER"]
      : ["ADMIN", "ACCOUNTANT", "MANAGER"];

  function showIssued(result: UserWithPassword) {
    setCopied(false);
    setIssued({
      fullName: result.user.fullName,
      phone: result.user.phone ?? "",
      password: result.password,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function copyIssued() {
    if (!issued) return;
    await navigator.clipboard.writeText(
      `${t("phone")}: ${issued.phone}\n${t("password")}: ${issued.password}`,
    );
    setCopied(true);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setSaving(true);
    try {
      const result = await apiRequest<UserWithPassword>("/users", {
        method: "POST",
        body: {
          fullName,
          phone,
          role,
          ...(password ? { password } : {}),
        },
      });
      setFullName("");
      setPhone("+998 ");
      setPassword("");
      setRole("MANAGER");
      showIssued(result);
      await reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : tc("error"));
    } finally {
      setSaving(false);
    }
  }

  async function toggle(user: UserItem) {
    if (user.id === me.data?.id) {
      setActionError(t("selfProtected"));
      return;
    }
    setActionError(null);
    setBusy(user.id);
    try {
      await apiRequest(`/users/${user.id}`, {
        method: "PATCH",
        body: { isActive: !user.isActive },
      });
      await reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : tc("error"));
    } finally {
      setBusy(null);
    }
  }

  async function resetPassword(user: UserItem) {
    if (!window.confirm(t("confirmReset", { name: user.fullName }))) return;
    setActionError(null);
    setBusy(user.id);
    try {
      const result = await apiRequest<UserWithPassword>(`/users/${user.id}/reset-password`, {
        method: "POST",
        body: {},
      });
      showIssued(result);
      await reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : tc("error"));
    } finally {
      setBusy(null);
    }
  }

  async function onDelete(user: UserItem) {
    if (user.id === me.data?.id) {
      setActionError(t("selfProtected"));
      return;
    }
    if (!window.confirm(`"${user.fullName}" foydalanuvchisini tizimdan butunlay o'chirishni tasdiqlaysizmi?`)) {
      return;
    }
    setActionError(null);
    setBusy(user.id);
    try {
      await apiRequest(`/users/${user.id}`, { method: "DELETE" });
      await reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : tc("error"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      {issued && (
        <div className="mb-5 rounded-2xl border border-amber-300 bg-amber-50 p-5 text-amber-900">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold">{t("issuedTitle", { name: issued.fullName })}</h2>
              <p className="mt-1 text-xs opacity-80">{t("issuedHint")}</p>
            </div>
            <div className="flex gap-2">
              <button type="button" className="btn-secondary text-xs" onClick={() => void copyIssued()}>
                {copied ? t("copied") : t("copy")}
              </button>
              <button type="button" className="btn-ghost text-xs" onClick={() => setIssued(null)}>
                {t("close")}
              </button>
            </div>
          </div>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs opacity-70">{t("phone")}</dt>
              <dd className="font-mono font-semibold">{issued.phone}</dd>
            </div>
            <div>
              <dt className="text-xs opacity-70">{t("password")}</dt>
              <dd className="font-mono text-base font-bold tracking-wide">{issued.password}</dd>
            </div>
          </dl>
        </div>
      )}

      <div className="card card-body mb-5">
        <h2 className="mb-4 text-sm font-bold text-slate-800">{t("addTitle")}</h2>
        <form onSubmit={onSubmit} className="space-y-4">
          {(formError || actionError) && <Alert tone="error">{formError ?? actionError}</Alert>}
          <div className="form-grid">
            <div>
              <label className="label" htmlFor="user-name">
                {t("fullName")}
              </label>
              <input
                id="user-name"
                className="input"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="user-phone">
                {t("phone")}
              </label>
              <input
                id="user-phone"
                type="tel"
                className="input font-mono"
                placeholder="+998 90 123 45 67"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="user-role">
                {t("role")}
              </label>
              <select
                id="user-role"
                className="select"
                value={role}
                onChange={(event) => setRole(event.target.value as Role)}
              >
                {roleOptions.map((option) => (
                  <option key={option} value={option}>
                    {t(option)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="user-password">
                {t("password")}
              </label>
              <input
                id="user-password"
                type="text"
                className="input font-mono"
                autoComplete="off"
                minLength={12}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <p className="mt-1 text-xs text-slate-500">{t("passwordHint")}</p>
            </div>
          </div>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? t("creating") : t("create")}
          </button>
        </form>
      </div>

      {/* Search & Filter Toolbar */}
      <div className="card p-3 mb-4 flex flex-col sm:flex-row items-center gap-3">
        <div className="flex-1 w-full">
          <input
            type="text"
            className="input w-full text-xs"
            placeholder="Foydalanuvchi yoki egasini F.I.Sh / telefon raqami bo'yicha qidirish..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="w-full sm:w-44">
          <select
            className="select w-full text-xs"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
          >
            <option value="">Barcha rollar</option>
            <option value="OWNER">Egasi (OWNER)</option>
            <option value="ADMIN">Administrator</option>
            <option value="ACCOUNTANT">Buxgalter</option>
            <option value="MANAGER">Dispetcher / Menejer</option>
          </select>
        </div>
        <div className="w-full sm:w-36">
          <select
            className="select w-full text-xs"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">Barcha holatlar</option>
            <option value="ACTIVE">Faol</option>
            <option value="INACTIVE">Faolsiz</option>
          </select>
        </div>
        {(searchQuery || roleFilter || statusFilter) && (
          <button
            type="button"
            onClick={() => {
              setSearchQuery("");
              setRoleFilter("");
              setStatusFilter("");
            }}
            className="text-xs text-slate-500 hover:text-slate-800 underline whitespace-nowrap"
          >
            Filtrni tozalash
          </button>
        )}
      </div>

      <div className="card">
        {loading ? (
          <Loading label={tc("loading")} />
        ) : error ? (
          <div className="p-5">
            <Alert tone="error">{error}</Alert>
          </div>
        ) : filteredUsers.length === 0 ? (
          <EmptyState>{searchQuery || roleFilter || statusFilter ? "Qidiruv bo'yicha hech qanday foydalanuvchi topilmadi" : t("empty")}</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("fullName")}</th>
                  <th>{t("phone")}</th>
                  <th>{t("role")}</th>
                  <th>{tc("status")}</th>
                  <th>{t("lastLogin")}</th>
                  <th>{tc("actions")}</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((user) => {
                  const isSelf = user.id === me.data?.id;
                  const ownerLocked = user.role === "OWNER" && me.data?.role !== "OWNER";
                  return (
                    <tr key={user.id}>
                      <td className="font-semibold text-slate-900">{user.fullName}</td>
                      <td className="font-mono text-sm text-slate-600">{user.phone ?? "—"}</td>
                      <td>{t(user.role)}</td>
                      <td>
                        <StatusBadge
                          status={user.isActive ? "ACTIVE" : "INACTIVE"}
                          label={user.isActive ? t("active") : t("inactive")}
                        />
                      </td>
                      <td className="whitespace-nowrap text-slate-500">
                        {user.lastLoginAt ? formatDateTime(user.lastLoginAt) : t("never")}
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          <button
                            type="button"
                            className="btn-ghost text-xs text-brand-700"
                            onClick={() => void resetPassword(user)}
                            disabled={isSelf || ownerLocked || busy === user.id}
                          >
                            {t("resetPassword")}
                          </button>
                          <button
                            type="button"
                            className="btn-ghost text-xs"
                            onClick={() => void toggle(user)}
                            disabled={isSelf || busy === user.id}
                          >
                            {user.isActive ? t("deactivate") : t("activate")}
                          </button>
                          <button
                            type="button"
                            className="btn-ghost text-xs font-semibold text-red-600 hover:bg-red-50"
                            onClick={() => void onDelete(user)}
                            disabled={isSelf || ownerLocked || busy === user.id}
                          >
                            {tc("delete")}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
