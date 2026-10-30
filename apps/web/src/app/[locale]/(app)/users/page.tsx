"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { apiRequest } from "@/lib/client-api";
import { formatDateTime, useApi } from "@/lib/use-api";
import type { AuthUser, UserItem } from "@/lib/types";
import { Alert, EmptyState, Loading, PageHeader, StatusBadge } from "@/components/ui";

type Role = "OWNER" | "ADMIN" | "ACCOUNTANT" | "MANAGER";

export default function UsersPage() {
  const t = useTranslations("users");
  const tc = useTranslations("common");
  const { data, loading, error, reload } = useApi<{ items: UserItem[] }>("/users");
  const me = useApi<AuthUser>("/auth/me");

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<Role>("MANAGER");
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const roleOptions: Role[] =
    me.data?.role === "OWNER"
      ? ["OWNER", "ADMIN", "ACCOUNTANT", "MANAGER"]
      : ["ADMIN", "ACCOUNTANT", "MANAGER"];

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setSaving(true);
    try {
      await apiRequest("/users", {
        method: "POST",
        body: {
          fullName,
          email,
          password,
          role,
          ...(phone ? { phone } : {}),
        },
      });
      setFullName("");
      setEmail("");
      setPassword("");
      setPhone("");
      setRole("MANAGER");
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
    try {
      await apiRequest(`/users/${user.id}`, {
        method: "PATCH",
        body: { isActive: !user.isActive },
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
              <label className="label" htmlFor="user-email">
                {t("email")}
              </label>
              <input
                id="user-email"
                type="email"
                className="input"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="user-password">
                {t("password")}
              </label>
              <input
                id="user-password"
                type="password"
                className="input"
                minLength={12}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
              <p className="mt-1 text-xs text-slate-500">{t("passwordHint")}</p>
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
              <label className="label" htmlFor="user-phone">
                {t("phone")}
              </label>
              <input
                id="user-phone"
                className="input"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
            </div>
          </div>
          <button type="submit" className="btn-primary" disabled={saving}>
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
                  <th>{t("fullName")}</th>
                  <th>{t("email")}</th>
                  <th>{t("role")}</th>
                  <th>{tc("status")}</th>
                  <th>{t("lastLogin")}</th>
                  <th>{tc("actions")}</th>
                </tr>
              </thead>
              <tbody>
                {data?.items.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <p className="font-semibold text-slate-900">{user.fullName}</p>
                      {user.phone && <p className="text-xs text-slate-400">{user.phone}</p>}
                    </td>
                    <td className="text-slate-600">{user.email}</td>
                    <td>{t(user.role)}</td>
                    <td>
                      <StatusBadge
                        status={user.isActive ? "ACTIVE" : "INACTIVE"}
                        label={user.isActive ? "Faol" : "Faolsiz"}
                      />
                    </td>
                    <td className="whitespace-nowrap text-slate-500">
                      {user.lastLoginAt ? formatDateTime(user.lastLoginAt) : t("never")}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn-ghost text-xs"
                        onClick={() => void toggle(user)}
                        disabled={user.id === me.data?.id}
                      >
                        {user.isActive ? t("deactivate") : t("activate")}
                      </button>
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
