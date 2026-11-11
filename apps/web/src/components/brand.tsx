import Image from "next/image";
import { Link } from "@/i18n/navigation";

export function Brand({ href = "/dashboard" }: { href?: string }) {
  return (
    <Link href={href} className="flex min-w-0 items-center gap-2.5 sm:gap-3">
      <Image
        src="/brand/bm-brutto-mark.webp"
        alt="BM Brutto"
        width={44}
        height={44}
        priority
        className="h-9 w-9 shrink-0 rounded-xl sm:h-11 sm:w-11"
      />
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-sm font-extrabold tracking-tight text-slate-900 sm:text-[15px] dark:text-white">
          Uyushmachilar
        </span>
        <span className="hidden text-[10px] font-medium uppercase tracking-[0.14em] text-slate-400 sm:block">
          Transport platformasi
        </span>
      </span>
    </Link>
  );
}
