import type { TransformFnParams } from "class-transformer";

export const UZ_PHONE = /^\+998\d{9}$/;
export const UZ_PHONE_MESSAGE = "Telefon raqam +998 XX XXX XX XX formatida bo'lsin";

/** "90 123 45 67", "998901234567", "+998 (90) 123-45-67" → "+998901234567". */
export function normalizeUzPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 9) return `+998${digits}`;
  if (digits.length === 12 && digits.startsWith("998")) return `+${digits}`;
  return value.trim();
}

export const toUzPhone = ({ value }: TransformFnParams) =>
  typeof value === "string" ? normalizeUzPhone(value) : value;
