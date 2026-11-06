import Link from "next/link";
import { apiUrl } from "@/lib/server-api";
import { PrintButton } from "@/components/print-button";
import { formatUzPlate } from "@/lib/plate";
import { formatUzPhone } from "@/lib/phone";

interface PublicPassportData {
  plateNumber: string;
  plateDisplay?: string;
  model: string;
  vin: string | null;
  companyName: string;
  routeName: string | null;
  routeNumber: string | null;
  driverName: string | null;
  driverPhone?: string | null;
  driverSource?: "SOLIQ" | "PLATFORM" | null;
  license: {
    number: string | null;
    expiresAt: string | null;
    isValid: boolean;
    daysLeft: number | null;
  };
  soliqLease: {
    contractNumber: string | null;
    startsAt?: string | null;
    endsAt: string | null;
    isValid: boolean;
    daysLeft: number | null;
    lesseeName?: string | null;
    lesseePinfl?: string | null;
    lesseePhone?: string | null;
  };
  shiftStatus: {
    isOnShift: boolean;
    startedAt: string | null;
  };
  complianceStatus: "FULLY_COMPLIANT" | "PARTIAL" | "EXPIRED" | "NO_RENT_CONTRACT";
  isVerified: boolean;
  verificationNotes?: string[];
  verifiedAt: string;
}

async function fetchPassport(plate: string): Promise<PublicPassportData | null> {
  try {
    const res = await fetch(
      apiUrl(`registry/public-verify/${encodeURIComponent(plate.toUpperCase().trim())}`),
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function fetchQrDataUrl(plate: string): Promise<string | null> {
  try {
    const res = await fetch(
      apiUrl(`registry/public-verify/${encodeURIComponent(plate.toUpperCase().trim())}/qr`),
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    return `data:image/png;base64,${buffer.toString("base64")}`;
  } catch {
    return null;
  }
}

export default async function PublicVerifyPage({
  params,
}: {
  params: Promise<{ locale: string; plate: string }>;
}) {
  const { locale, plate } = await params;
  const decodedPlate = decodeURIComponent(plate);
  const [data, qrDataUrl] = await Promise.all([
    fetchPassport(decodedPlate),
    fetchQrDataUrl(decodedPlate),
  ]);
  const plateDisplay = data?.plateDisplay || formatUzPlate(decodedPlate);

  const nowFormatted = new Intl.DateTimeFormat("uz-UZ", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Tashkent",
  }).format(new Date());

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-start p-4 sm:p-6 print:bg-white print:text-black">
      {/* Top Header */}
      <header className="w-full max-w-xl flex items-center justify-between pb-6 border-b border-slate-800 print:border-black">
        <div className="flex items-center gap-3">
          <img
            src="/brand/bm-brutto-mark.webp"
            alt="BM Brutto"
            width={40}
            height={40}
            className="h-10 w-10 rounded-xl"
          />
          <h1 className="font-bold text-sm leading-tight tracking-[0.06em] text-white sm:text-base sm:tracking-wide print:text-black">
            UYUSHMA RAQAMLI NAZORAT
          </h1>
        </div>
        <div className="shrink-0 text-right">
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold text-emerald-400 sm:px-2.5 sm:text-xs print:border-black print:text-black">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse print:hidden" />
            ONLAYN REYESTR
          </span>
        </div>
      </header>

      {/* Main Container */}
      <main className="w-full max-w-xl mt-6 space-y-6">
        {!data ? (
          <div className="bg-slate-900 border border-rose-500/30 rounded-2xl p-6 text-center shadow-xl">
            <div className="w-14 h-14 mx-auto rounded-full bg-rose-500/10 text-rose-400 flex items-center justify-center text-2xl font-bold mb-4">
              ✕
            </div>
            <h2 className="text-lg font-bold text-white mb-2">
              Avtomobil ma&apos;lumotlari topilmadi
            </h2>
            <p className="text-sm text-slate-400 mb-6">
              <span className="font-mono text-amber-400 font-bold">{plateDisplay}</span> davlat
              raqamli transport vositasi platforma reyestridan yoki faol integratsiyalardan topilmadi.
            </p>
            <Link
              href={`/${locale}`}
              className="inline-block px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-sm font-semibold text-white transition-colors"
            >
              Asosiy sahifaga qaytish
            </Link>
          </div>
        ) : (
          <>
            {/* Uzbek License Plate Card — rasmiy ko'rinish: UZ bayrog'i + to'liq raqam */}
            <div className="flex flex-col items-center">
              <div className="flex select-none items-stretch overflow-hidden rounded-lg border-2 border-slate-800 bg-white shadow-2xl">
                <div className="flex w-11 flex-col items-center justify-center gap-1 border-r-2 border-slate-800 bg-white px-1 py-1.5">
                  <div className="flex h-3 w-6 flex-col overflow-hidden rounded-[2px]">
                    <div className="h-1 bg-[#1e9bd7]" />
                    <div className="h-1 bg-white" />
                    <div className="h-1 bg-[#1eb53a]" />
                  </div>
                  <span className="font-sans text-[10px] font-black leading-none tracking-tight text-slate-900">
                    UZ
                  </span>
                </div>
                <div className="flex items-center px-4 py-2 sm:px-5">
                  <span className="whitespace-nowrap font-mono text-2xl font-black tracking-[0.14em] text-slate-950 sm:text-3xl">
                    {plateDisplay}
                  </span>
                </div>
              </div>
            </div>

            {/* Compliance Banner */}
            <div
              className={`rounded-2xl p-5 border shadow-xl flex items-start gap-4 ${
                data.complianceStatus === "FULLY_COMPLIANT"
                  ? "bg-emerald-950/40 border-emerald-500/40 text-emerald-100"
                  : data.complianceStatus === "EXPIRED"
                    ? "bg-rose-950/40 border-rose-500/40 text-rose-100"
                    : "bg-amber-950/40 border-amber-500/40 text-amber-100"
              }`}
            >
              <div
                className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl font-bold shrink-0 ${
                  data.complianceStatus === "FULLY_COMPLIANT"
                    ? "bg-emerald-500/20 text-emerald-400"
                    : data.complianceStatus === "EXPIRED"
                      ? "bg-rose-500/20 text-rose-400"
                      : "bg-amber-500/20 text-amber-400"
                }`}
              >
                {data.complianceStatus === "FULLY_COMPLIANT" ? "✓" : "!"}
              </div>
              <div className="flex-1">
                <div className="text-xs uppercase tracking-wider font-bold opacity-80 mb-0.5">
                  Texnik-Huquqiy Xulosa
                </div>
                <h3 className="font-bold text-base leading-tight">
                  {data.complianceStatus === "FULLY_COMPLIANT"
                    ? "QONUNIY FOYDALANISHGA TO'LIQ RUXSAT ETILGAN"
                    : data.complianceStatus === "EXPIRED"
                      ? "OGOHLANTIRISH: HUJJATLAR MUDDATI O'TGAN"
                      : data.complianceStatus === "NO_RENT_CONTRACT"
                        ? "DIQQAT: SOLIQ IJARA SHARTNOMASI RO'YXATDAN O'TMAGAN"
                        : "QISMAN QONUNIY (Hujjatlarni to'liq tekshiring)"}
                </h3>
                <p className="text-xs mt-1.5 opacity-90 leading-relaxed">
                  {data.complianceStatus === "FULLY_COMPLIANT"
                    ? "Mazkur transport vositasi O'zbekiston Respublikasi qonunchiligiga, Yo'l harakati xavfsizligi va Davlat Soliq me'yorlariga to'liq javob beradi."
                    : "Hujjatlar muddati yoki ijara shartnomasi rasmiylashtirilmagan. Jarima xavfi mavjud."}
                </p>
              </div>
            </div>

            {/* Passport Identity Sheet */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4 print:bg-white print:border-black">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800 print:border-slate-300">
                <span className="text-xs font-semibold uppercase text-slate-400 print:text-slate-600">
                  Raqamli Pasport Ma&apos;lumotlari
                </span>
                <span className="text-xs font-mono text-emerald-400 font-bold print:text-black">
                  ID: PASS-{plateDisplay}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="text-xs text-slate-400 print:text-slate-600">Model / Marka</div>
                  <div className="font-bold text-white print:text-black text-base mt-0.5">
                    {data.model}
                  </div>
                </div>

                <div>
                  <div className="text-xs text-slate-400 print:text-slate-600">Tashuvchi Korxona</div>
                  <div className="font-bold text-white print:text-black text-base mt-0.5">
                    {data.companyName}
                  </div>
                </div>

                <div>
                  <div className="text-xs text-slate-400 print:text-slate-600">Yo&apos;nalish</div>
                  <div className="font-bold text-amber-400 print:text-black text-sm mt-0.5">
                    {data.routeNumber ? `№ ${data.routeNumber}` : ""}{" "}
                    {data.routeName ? `(${data.routeName})` : "Biriktirilgan yo'nalish"}
                  </div>
                </div>

                <div>
                  <div className="text-xs text-slate-400 print:text-slate-600">
                    {data.driverSource === "SOLIQ" ? "Soliq ijarachi" : "Biriktirilgan haydovchi"}
                  </div>
                  <div className="font-bold text-white print:text-black text-sm mt-0.5">
                    {data.driverName ?? "Ko'rsatilmagan"}
                  </div>
                  {data.driverPhone && (
                    <div className="text-xs text-slate-400 print:text-slate-600 mt-0.5">
                      {formatUzPhone(data.driverPhone)}
                    </div>
                  )}
                </div>
              </div>

              {/* Smena Holati (Live Shift) */}
              <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between">
                <div>
                  <div className="text-xs text-slate-400 print:text-slate-600">Kunlik Smena Holati</div>
                  <div className="text-xs font-semibold mt-0.5 text-slate-300 print:text-black">
                    {data.shiftStatus.isOnShift && data.shiftStatus.startedAt
                      ? `Chiqish vaqti: ${new Date(data.shiftStatus.startedAt).toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" })}`
                      : "Ayni damda navbatda emas"}
                  </div>
                </div>
                <div>
                  {data.shiftStatus.isOnShift ? (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                      YO&apos;NALISHDA (Faol)
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-slate-800 text-slate-400 border border-slate-700">
                      Dam olishda
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* 360° Davlat Integratsiyalari Ko'rsatkichlari */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* E-Tender Litsenziya */}
              <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-lg print:border-black">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold uppercase text-slate-400 tracking-wider">
                    E-Tender Litsenziya
                  </span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded font-bold ${
                      data.license.isValid
                        ? "bg-emerald-500/10 text-emerald-400"
                        : "bg-rose-500/10 text-rose-400"
                    }`}
                  >
                    {data.license.isValid ? "FAOL" : "MUDDATI O'TGAN"}
                  </span>
                </div>
                <div className="text-sm font-bold text-white print:text-black">
                  {data.license.number ? `№ ${data.license.number}` : "Litsenziya kartochkasi"}
                </div>
                <div className="text-xs text-slate-400 mt-1">
                  Amal qilish:{" "}
                  <span className="text-slate-200 print:text-black font-semibold">
                    {data.license.expiresAt ?? "Muddatsiz"}
                  </span>
                </div>
                {data.license.daysLeft !== null && (
                  <div className="mt-2 text-xs font-semibold text-amber-400">
                    ⏱ {data.license.daysLeft > 0 ? `${data.license.daysLeft} kun qoldi` : "Muddati tugagan"}
                  </div>
                )}
              </div>

              {/* Soliq Ijara Shartnomasi */}
              <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-lg print:border-black">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold uppercase text-slate-400 tracking-wider">
                    Soliq Ijara (E-IJARA)
                  </span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded font-bold ${
                      data.soliqLease.isValid
                        ? "bg-emerald-500/10 text-emerald-400"
                        : "bg-rose-500/10 text-rose-400"
                    }`}
                  >
                    {data.soliqLease.isValid ? "QONUNIY" : "RO'YXATDA YO'Q"}
                  </span>
                </div>
                <div className="text-sm font-bold text-white print:text-black">
                  {data.soliqLease.contractNumber
                    ? `Shartnoma № ${data.soliqLease.contractNumber}`
                    : "Elektron ijara"}
                </div>
                <div className="text-xs text-slate-400 mt-1">
                  Amal qilish:{" "}
                  <span className="text-slate-200 print:text-black font-semibold">
                    {data.soliqLease.startsAt ?? "—"} — {data.soliqLease.endsAt ?? "Noma'lum"}
                  </span>
                </div>
                {data.soliqLease.lesseeName && (
                  <div className="text-xs text-slate-400 mt-1">
                    Ijarachi:{" "}
                    <span className="text-slate-200 print:text-black font-semibold">
                      {data.soliqLease.lesseeName}
                    </span>
                  </div>
                )}
                {data.soliqLease.lesseePinfl && (
                  <div className="text-[11px] font-mono text-slate-500 mt-0.5">
                    JSHSHIR: {data.soliqLease.lesseePinfl}
                  </div>
                )}
                {data.soliqLease.daysLeft !== null && (
                  <div className="mt-2 text-xs font-semibold text-cyan-400">
                    ⏱ {data.soliqLease.daysLeft > 0 ? `${data.soliqLease.daysLeft} kun qoldi` : "Muddati tugagan"}
                  </div>
                )}
              </div>
            </div>

            {/* Verification Metadata & QR Seal */}
            <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-400 print:border-black print:text-black">
              <div className="space-y-1 text-center sm:text-left">
                <div>
                  Tekshirildi:{" "}
                  <span className="text-slate-200 font-semibold">{nowFormatted}</span>
                </div>
                <div
                  className={`text-[11px] font-semibold ${
                    data.isVerified ? "text-emerald-400" : "text-amber-400"
                  }`}
                >
                  {data.isVerified
                    ? "Tasdiqlangan: Soliq ijara va e-tender ma'lumotlari faol"
                    : "Tasdiqlanmagan: hujjatlardan biri topilmadi yoki muddati o'tgan"}
                </div>
                {data.verificationNotes && data.verificationNotes.length > 0 && (
                  <ul className="text-[11px] text-slate-500 space-y-0.5">
                    {data.verificationNotes.map((note) => (
                      <li key={note}>• {note}</li>
                    ))}
                  </ul>
                )}
                <div className="pt-1 text-[11px] text-slate-500">
                  Pasport ID: <span className="font-mono text-slate-300 print:text-black">
                    PASS-{plateDisplay}
                  </span>
                </div>
              </div>

              <div className="flex flex-col items-center gap-2">
                {qrDataUrl && (
                  <div className="rounded-xl bg-white p-2 shadow-lg">
                    <img
                      src={qrDataUrl}
                      alt={`QR kod ${plateDisplay}`}
                      width={140}
                      height={140}
                      className="block h-[140px] w-[140px]"
                    />
                  </div>
                )}
                <p className="max-w-[150px] text-center text-[10px] leading-tight text-slate-500">
                  Kameradan skanerlang — pasport jonli reyestrdan qayta tekshiriladi
                </p>
                <div className="flex flex-col items-center gap-2 print:hidden">
                  <a
                    href={`/api/proxy/registry/public-verify/${encodeURIComponent(decodedPlate)}/pdf`}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-xs font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/20"
                  >
                    ⬇️ Ijara shartnomasi (PDF)
                  </a>
                  <PrintButton />
                </div>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
