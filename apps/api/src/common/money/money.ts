import { Prisma } from "@prisma/client";

export type DecimalInput = Prisma.Decimal | string | number;

export const UZS = "UZS";

/** UZS has no fractional unit in practice; all stored amounts are 2dp max. */
export function money(value: DecimalInput): Prisma.Decimal {
  const decimal = new Prisma.Decimal(value);
  if (!decimal.isFinite()) {
    throw new Error("Invalid money value");
  }
  return decimal.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

export function moneyString(value: Prisma.Decimal | null | undefined): string | null {
  return value ? value.toFixed(2) : null;
}

export function assertPositive(value: Prisma.Decimal, label = "Summa"): void {
  if (value.lte(0)) {
    throw new Error(`${label} noldan katta bo'lishi kerak`);
  }
}

export function assertNonNegative(value: Prisma.Decimal, label = "Summa"): void {
  if (value.lt(0)) {
    throw new Error(`${label} manfiy bo'lishi mumkin emas`);
  }
}
