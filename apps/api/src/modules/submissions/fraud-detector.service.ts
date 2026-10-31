import { Injectable, Logger } from "@nestjs/common";
import { createHash } from "node:crypto";
import { TenantTx } from "../../common/prisma/tenant-prisma.service";

export interface FraudCheckResult {
  risk: "LOW" | "MEDIUM" | "HIGH";
  score: number;
  flags: string[];
  imageHash: string;
  analysis: {
    fileSize: number;
    detectedSoftware?: string[];
    isDuplicateHash: boolean;
    isDuplicateTransaction: boolean;
    magicMime: string;
    details: string[];
    recommendation: string;
  };
}

const SUSPICIOUS_SOFTWARE_SIGNATURES = [
  { name: "Photoshop", pattern: /photoshop/i },
  { name: "Adobe", pattern: /adobe/i },
  { name: "PicsArt", pattern: /picsart/i },
  { name: "Snapseed", pattern: /snapseed/i },
  { name: "Pixelcut", pattern: /pixelcut/i },
  { name: "Canva", pattern: /canva/i },
  { name: "InShot", pattern: /inshot/i },
  { name: "GIMP", pattern: /gimp/i },
  { name: "Remini", pattern: /remini/i },
  { name: "PhotoRoom", pattern: /photoroom/i },
  { name: "Lightroom", pattern: /lightroom/i },
  { name: "Telegram Photo Editor", pattern: /telegram.*editor/i },
];

@Injectable()
export class FraudDetectorService {
  private readonly logger = new Logger(FraudDetectorService.name);

  /**
   * Chek rasmini AI va grafik redaktorlarda soxtalashtirilganlikka tekshiradi
   */
  async analyzeReceipt(
    tx: TenantTx,
    buffer: Buffer,
    meta: {
      tenantId: string;
      driverId: string;
      amount?: string;
      transactionNumber?: string;
    },
  ): Promise<FraudCheckResult> {
    const flags: string[] = [];
    const details: string[] = [];
    let score = 0;

    // 1. SHA-256 xesh
    const imageHash = createHash("sha256").update(buffer).digest("hex");

    // 2. Magic byte tekshiruvi (haqiqiy format)
    let magicMime = "unknown";
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      magicMime = "image/jpeg";
    } else if (
      buffer.length >= 8 &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
    ) {
      magicMime = "image/png";
    } else if (
      buffer.length >= 12 &&
      buffer.toString("ascii", 0, 4) === "RIFF" &&
      buffer.toString("ascii", 8, 12) === "WEBP"
    ) {
      magicMime = "image/webp";
    } else if (buffer.length >= 4 && buffer.toString("ascii", 0, 4) === "%PDF") {
      magicMime = "application/pdf";
    }

    if (magicMime === "unknown") {
      score += 40;
      flags.push("UNKNOWN_FILE_FORMAT");
      details.push("Fayl formati tanilmagan yoki rasm emas.");
    }

    // 3. Duplikat xesh tekshiruvi (bitta chekni qayta yuklash)
    const existingWithSameHash = await tx.paymentSubmission.findFirst({
      where: { imageHash },
      select: {
        id: true,
        createdAt: true,
        driver: { select: { fullName: true } },
        vehicle: { select: { plateNumber: true } },
      },
    });

    let isDuplicateHash = false;
    if (existingWithSameHash) {
      isDuplicateHash = true;
      score += 90;
      flags.push("DUPLICATE_IMAGE_HASH");
      const driverName = existingWithSameHash.driver?.fullName ?? "Noma'lum haydovchi";
      const vehiclePlate = existingWithSameHash.vehicle?.plateNumber ?? "";
      details.push(
        `Ushbu chek rasmi allaqachon ishlatilgan! Avvalgi ariza: ${driverName}${vehiclePlate ? ` (${vehiclePlate})` : ""}`,
      );
    }

    // 4. Tranzaksiya raqami duplikati
    let isDuplicateTransaction = false;
    if (meta.transactionNumber?.trim()) {
      const cleanTx = meta.transactionNumber.trim();
      const existingWithTx = await tx.paymentSubmission.findFirst({
        where: { transactionNumber: cleanTx },
        select: { id: true, createdAt: true },
      });
      if (existingWithTx) {
        isDuplicateTransaction = true;
        score += 85;
        flags.push("DUPLICATE_TRANSACTION_NUMBER");
        details.push(`Tranzaksiya raqami (${cleanTx}) bazada allaqachon mavjud!`);
      }
    }

    // 5. Metadata va EXIF ichidan grafik / AI tahrirlash dasturlari izlarini qidirish
    const detectedSoftware: string[] = [];
    const textPreview = buffer.toString("latin1");

    for (const item of SUSPICIOUS_SOFTWARE_SIGNATURES) {
      if (item.pattern.test(textPreview)) {
        detectedSoftware.push(item.name);
      }
    }

    if (detectedSoftware.length > 0) {
      score += 50;
      flags.push("SOFTWARE_EDITING_DETECTED");
      details.push(
        `Grafik tahrir yoki AI dasturi izlari aniqlandi: ${detectedSoftware.join(", ")}`,
      );
    }

    // 6. Fayl hajmi va siqilish anomaliyalari
    const fileSize = buffer.length;
    if (fileSize < 12 * 1024) {
      // 12 KB dan kichik rasm ko'pincha juda kuchli siqilgan yoki rasm emas
      score += 20;
      flags.push("SUSPICIOUS_LOW_FILE_SIZE");
      details.push("Chek hajmi shubhali darajada kichik (<12 KB).");
    }

    // 7. Xavf darajasini hisoblash
    let risk: "LOW" | "MEDIUM" | "HIGH" = "LOW";
    let recommendation = "Chek haqiqiy ko'rinadi. Bank hisobingizga tushum bo'lganini tekshirib tasdiqlang.";

    if (score >= 60) {
      risk = "HIGH";
      recommendation =
        "DIQQAT! Ushbu chekda jiddiy soxtalik alomatlari (duplikat rasm yoki Photoshop/redaktor tahriri) topildi! Bank hisobingizga pul tushmaguncha tasdiqlamang!";
    } else if (score >= 25) {
      risk = "MEDIUM";
      recommendation =
        "Ogohlantirish: chekda shubhali belgilar mavjud. Bank ilovasini ochib summani qat'iy tekshiring.";
    }

    return {
      risk,
      score: Math.min(score, 100),
      flags,
      imageHash,
      analysis: {
        fileSize,
        detectedSoftware: detectedSoftware.length > 0 ? detectedSoftware : undefined,
        isDuplicateHash,
        isDuplicateTransaction,
        magicMime,
        details,
        recommendation,
      },
    };
  }
}

