import { Prisma, TariffRuleOperation } from "@prisma/client";

export interface TariffRuleInput {
  code: string;
  label: string;
  operation: TariffRuleOperation;
  amount: Prisma.Decimal;
  priority: number;
}

export interface TariffCalculationInput {
  baseAmount: Prisma.Decimal;
  pricePerKm: Prisma.Decimal;
  distanceKm: Prisma.Decimal;
  rules: TariffRuleInput[];
}

export interface TariffLine {
  code: string;
  label: string;
  operation: TariffRuleOperation;
  amount: string;
  before: string;
  after: string;
}

export interface TariffCalculationResult {
  baseAmount: string;
  pricePerKm: string;
  distanceKm: string;
  distanceCharge: string;
  subtotal: string;
  total: string;
  currency: "UZS";
  lines: TariffLine[];
}

/**
 * All calculation is server-side and Decimal-based. Rules are applied by
 * priority (ascending, code as tiebreaker):
 *   ADD      -> total = total + amount
 *   OVERRIDE -> total = amount (replaces everything accumulated before it)
 */
export function calculateTariff(input: TariffCalculationInput): TariffCalculationResult {
  const cents = (value: Prisma.Decimal) =>
    value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

  const base = cents(input.baseAmount);
  const perKm = cents(input.pricePerKm);
  const distance = input.distanceKm;
  if (base.lt(0) || perKm.lt(0) || distance.lt(0)) {
    throw new Error("Tarif qiymatlari manfiy bo'lishi mumkin emas");
  }

  const distanceCharge = cents(perKm.mul(distance));
  let total = cents(base.add(distanceCharge));
  const subtotal = total;

  const lines: TariffLine[] = [];
  const ordered = [...input.rules].sort(
    (a, b) => a.priority - b.priority || a.code.localeCompare(b.code),
  );

  for (const rule of ordered) {
    const amount = cents(rule.amount);
    if (amount.lt(0)) {
      throw new Error(`"${rule.code}" qoidasi summasi manfiy bo'lishi mumkin emas`);
    }
    const before = total;
    total =
      rule.operation === "OVERRIDE"
        ? amount
        : cents(total.add(amount));
    lines.push({
      code: rule.code,
      label: rule.label,
      operation: rule.operation,
      amount: amount.toFixed(2),
      before: before.toFixed(2),
      after: total.toFixed(2),
    });
  }

  return {
    baseAmount: base.toFixed(2),
    pricePerKm: perKm.toFixed(2),
    distanceKm: distance.toFixed(2),
    distanceCharge: distanceCharge.toFixed(2),
    subtotal: subtotal.toFixed(2),
    total: total.toFixed(2),
    currency: "UZS",
    lines,
  };
}
