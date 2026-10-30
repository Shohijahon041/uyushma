import { Link } from "@/i18n/navigation";

export function Brand({
  href = "/dashboard",
  light = false,
}: {
  href?: string;
  light?: boolean;
}) {
  return (
    <Link href={href} className="flex items-center gap-3">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-800 text-lg font-black text-white shadow-md shadow-brand-600/20">
        U
      </span>
      <span className="leading-tight">
        <span
          className={`block text-[15px] font-extrabold tracking-tight ${
            light ? "text-white" : "text-slate-900"
          }`}
        >
          Uyushmachilar
        </span>
        <span
          className={`block text-[10px] font-medium uppercase tracking-[0.14em] ${
            light ? "text-brand-100/80" : "text-slate-400"
          }`}
        >
          Transport platformasi
        </span>
      </span>
    </Link>
  );
}
