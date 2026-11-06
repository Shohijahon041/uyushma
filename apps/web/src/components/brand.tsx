import Image from "next/image";
import { Link } from "@/i18n/navigation";

export function Brand({ href = "/dashboard" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-3">
      <Image
        src="/brand/bm-brutto-mark.webp"
        alt="BM Brutto"
        width={44}
        height={44}
        priority
        className="h-11 w-11 shrink-0 rounded-xl"
      />
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-[15px] font-extrabold tracking-tight text-slate-900 dark:text-white">
          Uyushmachilar
        </span>
        <span className="hidden text-[10px] font-medium uppercase tracking-[0.14em] text-slate-400 sm:block">
          Transport platformasi
        </span>
      </span>
    </Link>
  );
}
