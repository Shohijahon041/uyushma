import { BadRequestException } from "@nestjs/common";
import { parseDateOnly } from "./billing";

export const DRIVER_DOCUMENT_FIELDS = [
  "passportNumber",
  "passportIssuedBy",
  "passportIssuedAt",
  "pinfl",
  "birthDate",
  "passportPhotoFileId",
  "licenseNumber",
  "licenseCategories",
  "licenseIssuedAt",
  "licenseExpiresAt",
  "licensePhotoFileId",
] as const;

export type DriverDocumentField = (typeof DRIVER_DOCUMENT_FIELDS)[number];

export const DRIVER_PHOTO_KINDS = ["telegram", "passport", "license"] as const;
export type DriverPhotoKind = (typeof DRIVER_PHOTO_KINDS)[number];

const DATE_FIELDS = new Set<DriverDocumentField>([
  "passportIssuedAt",
  "birthDate",
  "licenseIssuedAt",
  "licenseExpiresAt",
]);

const CYRILLIC_TO_LATIN: Record<string, string> = {
  А: "A", В: "B", С: "C", Е: "E", Д: "D", М: "M", Т: "T", К: "K", Н: "H", О: "O", Р: "P", Х: "X",
};

function latinUpper(value: string): string {
  return value
    .toUpperCase()
    .replace(/[АВСЕДМТКНОРХ]/g, (char) => CYRILLIC_TO_LATIN[char] ?? char);
}

/** "DD.MM.YYYY" yoki "YYYY-MM-DD" -> DATE. */
export function parseHumanDate(raw: string): Date | null {
  const value = raw.trim();
  const dotted = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(value);
  const iso = dotted
    ? `${dotted[3]}-${dotted[2]!.padStart(2, "0")}-${dotted[1]!.padStart(2, "0")}`
    : value;
  return parseDateOnly(iso);
}

export const TELEGRAM_FILE_ID = /^[A-Za-z0-9_-]{20,255}$/;

/**
 * Haydovchi o'zi kiritadigan hujjat maydonini tekshiradi va saqlash uchun
 * qiymatga aylantiradi. Bo'sh qiymat — maydonni tozalash.
 */
export function normalizeDocumentValue(
  field: DriverDocumentField,
  raw: string | null | undefined,
): string | Date | null {
  const value = (raw ?? "").trim();
  if (!value || value === "-") return null;

  if (DATE_FIELDS.has(field)) {
    const date = parseHumanDate(value);
    if (!date) throw new BadRequestException("Sana noto'g'ri. Masalan: 25.03.2020");
    const year = date.getUTCFullYear();
    if (year < 1930 || year > 2100) throw new BadRequestException("Sana noto'g'ri");
    if (field !== "licenseExpiresAt" && date.getTime() > Date.now()) {
      throw new BadRequestException("Sana kelajakda bo'lishi mumkin emas");
    }
    return date;
  }

  switch (field) {
    case "passportNumber": {
      const normalized = latinUpper(value).replace(/\s+/g, "");
      if (!/^[A-Z]{2}\d{7}$/.test(normalized)) {
        throw new BadRequestException("Passport seriya va raqami: AA1234567 ko'rinishida");
      }
      return normalized;
    }
    case "licenseNumber": {
      const normalized = latinUpper(value).replace(/\s+/g, "");
      if (!/^[A-Z0-9]{5,20}$/.test(normalized)) {
        throw new BadRequestException("Guvohnoma raqami: AF1234567 ko'rinishida");
      }
      return normalized;
    }
    case "pinfl": {
      const digits = value.replace(/\s+/g, "");
      if (!/^\d{14}$/.test(digits)) {
        throw new BadRequestException("JSHSHIR 14 ta raqamdan iborat bo'lishi kerak");
      }
      return digits;
    }
    case "licenseCategories": {
      const categories = latinUpper(value)
        .split(/[\s,;]+/)
        .filter(Boolean);
      if (
        categories.length === 0 ||
        !categories.every((item) => /^(A|A1|B|B1|BE|C|C1|CE|C1E|D|D1|DE|D1E|M|TM|TB)$/.test(item))
      ) {
        throw new BadRequestException("Toifalar: masalan B, C, D");
      }
      return Array.from(new Set(categories)).join(", ").slice(0, 40);
    }
    case "passportIssuedBy": {
      if (value.length < 2 || value.length > 160) {
        throw new BadRequestException("Kim tomonidan berilgani 2-160 belgi bo'lishi kerak");
      }
      return value;
    }
    case "passportPhotoFileId":
    case "licensePhotoFileId": {
      if (!TELEGRAM_FILE_ID.test(value)) throw new BadRequestException("Rasm noto'g'ri");
      return value;
    }
    default:
      throw new BadRequestException("Maydon noto'g'ri");
  }
}

export function documentsView(driver: {
  passportNumber: string | null;
  passportIssuedBy: string | null;
  passportIssuedAt: Date | null;
  pinfl: string | null;
  birthDate: Date | null;
  passportPhotoFileId: string | null;
  licenseNumber: string | null;
  licenseCategories: string | null;
  licenseIssuedAt: Date | null;
  licenseExpiresAt: Date | null;
  licensePhotoFileId: string | null;
}) {
  const day = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : null);
  return {
    passport: {
      number: driver.passportNumber,
      issuedBy: driver.passportIssuedBy,
      issuedAt: day(driver.passportIssuedAt),
      pinfl: driver.pinfl,
      birthDate: day(driver.birthDate),
      hasPhoto: driver.passportPhotoFileId !== null,
    },
    license: {
      number: driver.licenseNumber,
      categories: driver.licenseCategories,
      issuedAt: day(driver.licenseIssuedAt),
      expiresAt: day(driver.licenseExpiresAt),
      hasPhoto: driver.licensePhotoFileId !== null,
    },
  };
}
