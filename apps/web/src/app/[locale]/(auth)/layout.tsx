import { getTranslations, setRequestLocale } from "next-intl/server";
import { Brand } from "@/components/brand";
import { LanguageSwitcher } from "@/components/language-switcher";

export default async function AuthLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "common" });
  const ta = await getTranslations({ locale, namespace: "auth" });

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <section className="relative hidden overflow-hidden bg-gradient-to-br from-[#0b1f45] via-[#103473] to-[#1b6ff0] p-12 lg:flex lg:flex-col lg:justify-between">
        <div
          className="pointer-events-none absolute inset-0 opacity-30"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 20%, rgba(255,255,255,.25) 0, transparent 28%), radial-gradient(circle at 80% 70%, rgba(255,255,255,.16) 0, transparent 30%)",
          }}
        />
        <div className="relative">
          <Brand light />
        </div>
        <div className="relative max-w-lg">
          <p className="mb-4 inline-flex rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-brand-100">
            B2B SaaS · O'zbekiston
          </p>
          <h1 className="text-4xl font-extrabold leading-tight tracking-tight text-white">
            {t("tagline")}
          </h1>
          <p className="mt-4 text-base leading-relaxed text-brand-100/90">
            {ta("loginSubtitle")}
          </p>
          <ul className="mt-8 space-y-3 text-sm text-brand-50/90">
            {[
              "Har bir kompaniya ma'lumoti alohida tenant sifatida himoyalangan",
              "Shartnoma, yo'nalish, tarif va to'lovlar yagona tizimda",
              "Barcha moliyaviy hisob-kitoblar serverda, Decimal aniqligida",
            ].map((item) => (
              <li key={item} className="flex gap-2.5">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-300" />
                {item}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-brand-100/60">
          © {new Date().getFullYear()} Uyushmachilar
        </p>
      </section>

      <section className="relative flex min-h-screen flex-col bg-white">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5 lg:justify-end">
          <div className="lg:hidden">
            <Brand href="/login" />
          </div>
          <LanguageSwitcher />
        </div>
        <div className="flex flex-1 items-center justify-center px-5 py-10">
          <div className="w-full max-w-md">{children}</div>
        </div>
      </section>
    </div>
  );
}
