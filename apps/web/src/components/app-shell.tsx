"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { useApi } from "@/lib/use-api";
import { sessionLogout } from "@/lib/client-api";
import type { AuthUser } from "@/lib/types";
import { Brand } from "./brand";
import { Icon, type IconName } from "./icons";
import { LanguageSwitcher } from "./language-switcher";
import { QuickPayButton } from "./quick-pay";
import { ThemeToggle } from "./theme-toggle";

interface NavItem {
  href: string;
  labelKey: string;
  icon: IconName;
  roles?: Array<AuthUser["role"]>;
  superAdminOnly?: boolean;
}

const SECTIONS: Array<{ titleKey?: string; items: NavItem[] }> = [
  {
    items: [{ href: "/dashboard", labelKey: "dashboard", icon: "dashboard" }],
  },
  {
    titleKey: "operations",
    items: [
      { href: "/vehicles", labelKey: "vehicles", icon: "truck" },
      { href: "/drivers", labelKey: "drivers", icon: "users" },
      { href: "/routes", labelKey: "routes", icon: "map" },
      { href: "/contracts", labelKey: "contracts", icon: "file" },
      { href: "/registry", labelKey: "registry", icon: "database" },
      {
        href: "/collector",
        labelKey: "collector",
        icon: "database",
        superAdminOnly: true,
      },
      { href: "/tariffs", labelKey: "tariffs", icon: "tag" },
    ],
  },
  {
    titleKey: "finance",
    items: [
      {
        href: "/daily",
        labelKey: "daily",
        icon: "wallet",
        roles: ["OWNER", "ADMIN", "ACCOUNTANT"],
      },
      {
        href: "/payments",
        labelKey: "payments",
        icon: "wallet",
        roles: ["OWNER", "ADMIN", "ACCOUNTANT"],
      },
      {
        href: "/submissions",
        labelKey: "submissions",
        icon: "file",
        roles: ["OWNER", "ADMIN", "ACCOUNTANT"],
      },
      { href: "/subscription", labelKey: "subscription", icon: "card" },
    ],
  },
  {
    titleKey: "administration",
    items: [
      {
        href: "/admin",
        labelKey: "admin",
        icon: "shield",
        superAdminOnly: true,
      },
      {
        href: "/users",
        labelKey: "users",
        icon: "users",
        roles: ["OWNER", "ADMIN"],
      },
      {
        href: "/notifications",
        labelKey: "notifications",
        icon: "bell",
        roles: ["OWNER", "ADMIN", "ACCOUNTANT"],
      },
      {
        href: "/audit",
        labelKey: "audit",
        icon: "shield",
        roles: ["OWNER", "ADMIN", "ACCOUNTANT"],
      },
      { href: "/settings", labelKey: "settings", icon: "settings" },
    ],
  },
];

const PLATFORM_SECTION: NavItem[] = [
  { href: "/admin", labelKey: "admin", icon: "shield" },
  { href: "/collector", labelKey: "collector", icon: "database" },
  { href: "/settings", labelKey: "settings", icon: "settings" },
];

function NavLinks({
  role,
  isSuperAdmin,
  platform = false,
  onNavigate,
  horizontal = false,
}: {
  role: AuthUser["role"];
  isSuperAdmin: boolean;
  platform?: boolean;
  onNavigate?: () => void;
  horizontal?: boolean;
}) {
  const t = useTranslations("nav");
  const pathname = usePathname();

  if (platform) {
    return (
      <nav className={horizontal ? "flex gap-1" : "space-y-0.5"}>
        {PLATFORM_SECTION.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch={true}
              onClick={onNavigate}
              className={`flex items-center gap-3 rounded-xl px-3 py-2 text-[13px] font-medium transition ${
                active ? "bg-brand-50 text-brand-800" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              } ${horizontal ? "whitespace-nowrap" : ""}`}
            >
              <Icon
                name={item.icon}
                className={`h-[18px] w-[18px] ${active ? "text-brand-700" : "text-slate-400"}`}
              />
              {t(item.labelKey)}
            </Link>
          );
        })}
      </nav>
    );
  }

  return (
    <>
      {SECTIONS.map((section, index) => {
        const items = section.items.filter(
          (item) =>
            (!item.roles || item.roles.includes(role)) &&
            (!item.superAdminOnly || isSuperAdmin),
        );
        if (items.length === 0) return null;
        return (
          <div key={section.titleKey ?? `section-${index}`} className={horizontal ? "flex items-center gap-1" : "mb-5"}>
            {!horizontal && section.titleKey && (
              <p className="mb-1.5 px-3 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                {t(section.titleKey)}
              </p>
            )}
            <nav className={horizontal ? "flex gap-1" : "space-y-0.5"}>
              {items.map((item) => {
                const active =
                  pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    prefetch={true}
                    onClick={onNavigate}
                    className={`flex items-center gap-3 rounded-xl px-3 py-2 text-[13px] font-medium transition ${
                      active
                        ? "bg-brand-50 text-brand-800"
                        : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                    } ${horizontal ? "whitespace-nowrap" : ""}`}
                  >
                    <Icon
                      name={item.icon}
                      className={`h-[18px] w-[18px] ${active ? "text-brand-700" : "text-slate-400"}`}
                    />
                    {t(item.labelKey)}
                  </Link>
                );
              })}
            </nav>
          </div>
        );
      })}
    </>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations("common");
  const router = useRouter();
  const pathname = usePathname();
  const { data: me, loading, error, reload } = useApi<AuthUser>("/auth/me");
  const [loggingOut, setLoggingOut] = useState(false);

  const isPlatform = Boolean(me?.company.isPlatform);

  useEffect(() => {
    if (error && error.toLowerCase().includes("avtorizatsiya")) {
      router.replace("/login");
    }
  }, [error, router]);

  useEffect(() => {
    if (!isPlatform) return;
    const allowed = pathname === "/admin" || pathname.startsWith("/admin/") ||
      pathname === "/collector" || pathname.startsWith("/collector/") ||
      pathname === "/settings" || pathname.startsWith("/settings/");
    if (!allowed) router.replace("/admin");
  }, [isPlatform, pathname, router]);

  const initials = useMemo(() => {
    if (!me) return "U";
    return me.fullName
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("");
  }, [me]);

  async function onLogout() {
    setLoggingOut(true);
    await sessionLogout().catch(() => undefined);
    router.replace("/login");
  }

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 text-slate-500">
        <div className="h-9 w-9 animate-spin rounded-full border-[3px] border-slate-200 border-t-brand-600" />
        <p className="text-sm">{t("loading")}</p>
      </div>
    );
  }

  if (!me) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="card card-body w-full max-w-md text-center">
          <p className="text-sm font-semibold text-slate-800">Tizimga ulanish imkoni yo'q</p>
          <p className="mt-2 text-sm text-slate-500">{error ?? "Sessiyani tekshiring."}</p>
          <div className="mt-5 flex justify-center gap-2">
            <button type="button" className="btn-secondary" onClick={() => void reload()}>
              {t("refresh")}
            </button>
            <button type="button" className="btn-primary" onClick={() => router.replace("/login")}>
              {t("logout")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f5f7fb]">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-slate-200 bg-white md:flex">
        <div className="border-b border-slate-100 px-5 py-5">
          <Brand />
        </div>
        <div className="mx-4 mt-4 rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2.5">
          <p className="truncate text-xs font-semibold text-slate-800">
            {isPlatform ? "Platforma boshqaruvi" : me.company.name}
          </p>
          <p className="truncate font-mono text-[10px] text-slate-400">
            {isPlatform ? "super admin" : me.company.slug}
          </p>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-5">
          <NavLinks role={me.role} isSuperAdmin={me.isSuperAdmin} platform={isPlatform} />
        </div>
        <div className="border-t border-slate-100 p-3">
          <div className="flex items-center gap-3 rounded-xl px-2 py-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-800">
              {initials}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-slate-800">{me.fullName}</p>
              <p className="truncate text-[10px] text-slate-400">{me.role}</p>
            </div>
            <button
              type="button"
              onClick={() => void onLogout()}
              disabled={loggingOut}
              className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-red-600"
              aria-label={t("logout")}
              title={t("logout")}
            >
              <Icon name="logout" className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      <div className="md:pl-64">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
          <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <div className="md:hidden">
              <Brand />
            </div>
            <div className="hidden md:block">
              <p className="text-xs font-medium text-slate-400">
                {isPlatform ? "Platforma" : "Kompaniya"}
              </p>
              <p className="text-sm font-semibold text-slate-800">
                {isPlatform ? "Barcha korxonalar nazorati" : me.company.name}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {!isPlatform &&
                (["OWNER", "ADMIN", "ACCOUNTANT"] as const).some((role) => role === me.role) && (
                  <QuickPayButton />
                )}
              {!isPlatform && (
                <Link
                  href="/notifications"
                  className="relative rounded-xl border border-slate-200 bg-white p-2 text-slate-500 transition hover:bg-slate-50 hover:text-slate-700"
                  title="Bildirishnomalar"
                >
                  <Icon name="bell" className="h-4 w-4" />
                  <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-brand-500" />
                </Link>
              )}
              <LanguageSwitcher />
              <ThemeToggle />
              <span className="hidden items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 sm:flex">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                {me.company.status === "ACTIVE" ? "Faol" : me.company.status}
              </span>
            </div>
          </div>
          <div className="overflow-x-auto border-t border-slate-100 px-3 py-2 md:hidden">
            <NavLinks role={me.role} isSuperAdmin={me.isSuperAdmin} platform={isPlatform} horizontal />
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
