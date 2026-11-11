import Link from "next/link";
import { notFound } from "next/navigation";
import { apiUrl } from "@/lib/server-api";
import { PrintButton } from "@/components/print-button";
import { formatUzPlate } from "@/lib/plate";
import { formatUzPhone } from "@/lib/phone";

interface PublicWaybillData {
  id: string;
  number: string;
  status: "ISSUED" | "ACTIVE" | "COMPLETED" | "CANCELLED";
  date: string;
  validUntil: string;
  companyName: string;
  driverName: string;
  driverPhone?: string | null;
  licenseNumber?: string | null;
  plateNumber: string;
  vehicleModel: string;
  ownerName?: string | null;
  ownerPhone?: string | null;
  routeName?: string | null;
  routeNumber?: string | null;
  medicalPassed: boolean;
  medicalDoctorName?: string | null;
  medicalCheckedAt?: string | null;
  medicalNotes?: string | null;
  technicalPassed: boolean;
  mechanicName?: string | null;
  technicalCheckedAt?: string | null;
  technicalNotes?: string | null;
  startOdometer?: number | null;
  endOdometer?: number | null;
  distanceKm?: number | null;
  departureTime?: string | null;
  returnTime?: string | null;
  fuelType?: string | null;
  fuelBefore?: string | null;
  fuelGiven?: string | null;
  fuelAfter?: string | null;
  dispatcherName?: string | null;
  specialNotes?: string | null;
}

async function fetchWaybill(token: string): Promise<PublicWaybillData | null> {
  try {
    const res = await fetch(
      apiUrl(`waybills/public-verify/${encodeURIComponent(token.trim())}`),
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function fetchQrDataUrl(token: string): Promise<string | null> {
  try {
    const res = await fetch(
      apiUrl(`waybills/public-verify/${encodeURIComponent(token.trim())}/qr`),
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    return `data:image/png;base64,${buffer.toString("base64")}`;
  } catch {
    return null;
  }
}

export default async function PublicWaybillVerifyPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  const [data, qrDataUrl] = await Promise.all([
    fetchWaybill(token),
    fetchQrDataUrl(token),
  ]);

  if (!data) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-4">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center space-y-4">
          <div className="text-4xl">⚠️</div>
          <h1 className="text-xl font-bold text-slate-100">Yo&apos;l varaqasi topilmadi</h1>
          <p className="text-sm text-slate-400">
            Tekshirilayotgan QR kod eskirgan, xato yoki tizimda bunday yo&apos;l varaqasi mavjud emas.
          </p>
          <Link
            href="/uz/login"
            className="inline-block mt-4 text-xs font-semibold px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl transition"
          >
            Tizimga kirish
          </Link>
        </div>
      </div>
    );
  }

  const isValid = data.status === "ACTIVE" && new Date(data.validUntil) >= new Date();
  const isExpired = new Date(data.validUntil) < new Date();

  const formattedDate = new Intl.DateTimeFormat("uz-UZ", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Tashkent",
  });

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-start p-4 sm:p-6 print:bg-white print:text-black print:p-0 print:block">
      {/* Print Page Setup */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @media print {
              @page {
                size: A4 portrait;
                margin: 10mm 12mm;
              }
              html, body {
                background: #ffffff !important;
                color: #000000 !important;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
              }
            }
          `,
        }}
      />

      {/* Top Header */}
      <header className="w-full max-w-xl print:max-w-none flex items-center justify-between pb-6 border-b border-slate-800 print:border-black print:pb-3">
        <div className="flex items-center gap-3">
          <img
            src="/brand/bm-brutto-mark.webp"
            alt="BM Brutto"
            width={40}
            height={40}
            className="h-10 w-10 rounded-xl"
          />
          <div>
            <div className="text-xs uppercase tracking-wider text-slate-400 font-semibold print:text-slate-700">
              O&apos;zbekiston Respublikasi
            </div>
            <div className="text-sm font-bold text-slate-100 print:text-black">
              Yagona Yo&apos;l Varaqasi Reyestri
            </div>
          </div>
        </div>
        <div className="print:hidden">
          <PrintButton />
        </div>
      </header>

      {/* Main Container */}
      <main className="w-full max-w-xl print:max-w-none py-6 print:py-3 space-y-5 print:space-y-3.5">
        {/* Status Hero Card */}
        <div
          className={`rounded-2xl p-5 border text-center transition-all ${
            data.status === "CANCELLED"
              ? "bg-red-950/40 border-red-800/60 text-red-200"
              : isExpired
                ? "bg-amber-950/40 border-amber-800/60 text-amber-200"
                : isValid
                  ? "bg-emerald-950/40 border-emerald-800/60 text-emerald-200"
                  : "bg-slate-900 border-slate-800 text-slate-200"
          } print:bg-transparent print:border-black print:text-black`}
        >
          <div className="inline-flex items-center justify-center p-3 rounded-2xl mb-2 text-3xl">
            {data.status === "CANCELLED" ? "❌" : isExpired ? "⏳" : isValid ? "🛡️" : "📑"}
          </div>
          <h2 className="text-xl font-bold tracking-tight">
            {data.status === "CANCELLED"
              ? "BEKOR QILINGAN"
              : isExpired
                ? "MUDDATI O'TGAN"
                : isValid
                  ? "HAQIQIY VA AMALDA"
                  : data.status === "COMPLETED"
                    ? "YAKUNLANGAN"
                    : "RASMIYLASHTIRILGAN"}
          </h2>
          <p className="text-xs mt-1 opacity-80">
            {isValid
              ? "Yo'l varaqasi barcha texnik va tibbiy talablarga javob beradi. Reysga to'liq ruxsat etilgan."
              : data.status === "COMPLETED"
                ? "Reys muvaffaqiyatli yakunlangan va qaytish qayd etilgan."
                : "Hujjat amalda emas yoki muddati tugagan."}
          </p>

          <div className="mt-4 pt-3 border-t border-slate-800/60 print:border-black/20 flex items-center justify-around text-xs">
            <div>
              <span className="text-slate-400 print:text-slate-600 block">Varaqa raqami:</span>
              <span className="font-mono font-bold text-sm text-slate-100 print:text-black">
                {data.number}
              </span>
            </div>
            <div>
              <span className="text-slate-400 print:text-slate-600 block">Berilgan sana:</span>
              <span className="font-semibold text-slate-100 print:text-black">
                {data.date ? data.date.slice(0, 10) : "-"}
              </span>
            </div>
            <div>
              <span className="text-slate-400 print:text-slate-600 block">Amal qiladi:</span>
              <span className="font-semibold text-slate-100 print:text-black">
                {data.validUntil ? data.validUntil.slice(0, 10) : "-"}
              </span>
            </div>
          </div>
        </div>

        {/* Company & Vehicle Info */}
        <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 print:bg-transparent print:border-black">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-3 print:border-black/20">
            <span className="text-xs text-slate-400 uppercase font-semibold">Tashkilot (Tashuvchi):</span>
            <span className="text-sm font-bold text-slate-100 print:text-black">
              {data.companyName}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="text-xs text-slate-400 block mb-1">Davlat raqami:</span>
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-xl font-mono font-bold text-emerald-400 text-sm print:bg-white print:border-black print:text-black">
                🇺🇿 {formatUzPlate(data.plateNumber)}
              </div>
            </div>
            <div>
              <span className="text-xs text-slate-400 block mb-1">Avtomobil rusumi:</span>
              <span className="text-sm font-semibold text-slate-100 print:text-black">
                {data.vehicleModel}
              </span>
            </div>
          </div>

          {data.ownerName && (
            <div className="flex items-center justify-between border-t border-slate-800/60 pt-2.5 print:border-black/20">
              <span className="text-xs text-slate-400">Transport haqiqiy egasi (mulkdor):</span>
              <span className="text-sm font-bold text-slate-100 print:text-black">
                {data.ownerName}
                {data.ownerPhone && (
                  <span className="text-xs text-slate-400 font-normal ml-1">
                    ({formatUzPhone(data.ownerPhone)})
                  </span>
                )}
              </span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 pt-2">
            <div>
              <span className="text-xs text-slate-400 block mb-1">Haydovchi (F.I.Sh.):</span>
              <span className="text-sm font-semibold text-slate-100 print:text-black">
                {data.driverName}
              </span>
              {data.driverPhone && (
                <span className="text-xs text-slate-400 block mt-0.5">
                  {formatUzPhone(data.driverPhone)}
                </span>
              )}
            </div>
            <div>
              <span className="text-xs text-slate-400 block mb-1">Guvohnoma (Prava):</span>
              <span className="text-sm font-mono text-slate-100 print:text-black">
                {data.licenseNumber ?? "Qayd etilgan"}
              </span>
            </div>
          </div>

          {data.routeName && (
            <div className="pt-2 border-t border-slate-800/60 print:border-black/20">
              <span className="text-xs text-slate-400 block mb-0.5">Yo&apos;nalish:</span>
              <span className="text-sm font-semibold text-slate-200 print:text-black">
                {data.routeName} {data.routeNumber ? `(№ ${data.routeNumber})` : ""}
              </span>
            </div>
          )}
        </section>

        {/* Inspections (Medical & Technical) */}
        <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Medical */}
          <div
            className={`rounded-2xl p-4 border ${
              data.medicalPassed
                ? "bg-slate-900 border-emerald-900/40"
                : "bg-red-950/30 border-red-800/40"
            } print:bg-transparent print:border-black`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-slate-300 uppercase tracking-wider print:text-black">
                🩺 Tibbiy ko&apos;rik
              </span>
              <span
                className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                  data.medicalPassed
                    ? "bg-emerald-900/60 text-emerald-300"
                    : "bg-red-900/60 text-red-300"
                } print:bg-transparent print:text-black`}
              >
                {data.medicalPassed ? "✅ Ruxsat berildi" : "❌ Ruxsat yo'q"}
              </span>
            </div>
            <div className="text-xs text-slate-400 space-y-1">
              <div>
                Shifokor:{" "}
                <span className="font-semibold text-slate-200 print:text-black">
                  {data.medicalDoctorName ?? "Tibbiyot xodimi"}
                </span>
              </div>
              {data.medicalCheckedAt && (
                <div>Vaqti: {formattedDate.format(new Date(data.medicalCheckedAt))}</div>
              )}
              {data.medicalNotes && (
                <div className="text-[11px] text-slate-400 italic mt-1">
                  &ldquo;{data.medicalNotes}&rdquo;
                </div>
              )}
            </div>
          </div>

          {/* Technical */}
          <div
            className={`rounded-2xl p-4 border ${
              data.technicalPassed
                ? "bg-slate-900 border-emerald-900/40"
                : "bg-red-950/30 border-red-800/40"
            } print:bg-transparent print:border-black`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-slate-300 uppercase tracking-wider print:text-black">
                🔧 Texnik ko&apos;rik
              </span>
              <span
                className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                  data.technicalPassed
                    ? "bg-emerald-900/60 text-emerald-300"
                    : "bg-red-900/60 text-red-300"
                } print:bg-transparent print:text-black`}
              >
                {data.technicalPassed ? "✅ Ruxsat berildi" : "❌ Ruxsat yo'q"}
              </span>
            </div>
            <div className="text-xs text-slate-400 space-y-1">
              <div>
                Mexanik:{" "}
                <span className="font-semibold text-slate-200 print:text-black">
                  {data.mechanicName ?? "Mas'ul mexanik"}
                </span>
              </div>
              {data.technicalCheckedAt && (
                <div>Vaqti: {formattedDate.format(new Date(data.technicalCheckedAt))}</div>
              )}
              {data.technicalNotes && (
                <div className="text-[11px] text-slate-400 italic mt-1">
                  &ldquo;{data.technicalNotes}&rdquo;
                </div>
              )}
            </div>
          </div>
        </section>

        {/* QR Code and Verification footer */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col sm:flex-row items-center gap-5 print:bg-transparent print:border-black">
          {qrDataUrl && (
            <div className="bg-white p-2 rounded-xl flex-shrink-0 shadow-lg">
              <img
                src={qrDataUrl}
                alt="Yo'l varaqasi QR kodi"
                width={120}
                height={120}
                className="w-28 h-28"
              />
            </div>
          )}
          <div className="text-xs text-slate-400 space-y-2 text-center sm:text-left">
            <div className="font-semibold text-slate-200 print:text-black text-sm">
              Elektron yo&apos;l varaqasi tasdig&apos;i
            </div>
            <p>
              Ushbu sahifa Davlat Yo&apos;l Harakati Xavfsizligi Xizmati (YPX) va Transport Nazorati inspeksiyasi uchun yo&apos;l varaqasining haqiqiyligini real vaqt rejimida tasdiqlaydi.
            </p>
            <div className="text-[11px] text-slate-500 font-mono">
              ID: {data.id}
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="w-full max-w-xl text-center pt-6 text-xs text-slate-500 print:text-slate-700">
        &copy; {new Date().getFullYear()} BM Brutto &bull; O&apos;zbekiston Transport Tizimlari
      </footer>
    </div>
  );
}

