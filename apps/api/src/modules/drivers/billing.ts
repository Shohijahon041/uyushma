// Kunlik to'lov hisobi uchun sof funksiyalar. Vaqt O'zbekiston (UTC+5) bo'yicha
// hisoblanadi — haydovchi ertalab to'laganda sana shu mintaqada aniqlanadi.

export const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;

export interface MonthTotals {
  due: number;
  paid: number;
  debt: number;
  surplus: number;
}

export interface DatedAmount<Key extends string> {
  key: Key;
  periodStart: Date;
  amount: number;
}

function utcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day));
}

/** Timestamp -> o'sha oyning 1-kuni (UTC yarim tun, @db.Date uchun). */
export function periodStartFor(date: Date): Date {
  const shifted = new Date(date.getTime() + TASHKENT_OFFSET_MS);
  return utcDate(shifted.getUTCFullYear(), shifted.getUTCMonth(), 1);
}

export function currentPeriodStart(now = new Date()): Date {
  return periodStartFor(now);
}

/** "YYYY-MM" (Toshkent oyi) -> oyning 1-kuni. Noto'g'ri qiymatda null. */
export function parsePeriod(value: string | undefined | null): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return utcDate(year, month - 1, 1);
}

export function formatPeriod(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function addMonths(period: Date, months: number): Date {
  return utcDate(period.getUTCFullYear(), period.getUTCMonth() + months, 1);
}

/** [from, to] oylari ro'yxati (ikkalasi ham oy boshi). */
export function monthsBetween(from: Date, to: Date): Date[] {
  const result: Date[] = [];
  let cursor = utcDate(from.getUTCFullYear(), from.getUTCMonth(), 1);
  const end = utcDate(to.getUTCFullYear(), to.getUTCMonth(), 1);
  while (cursor.getTime() <= end.getTime()) {
    result.push(cursor);
    cursor = addMonths(cursor, 1);
  }
  return result;
}

/** "YYYY-MM-DD" kalendar sanasi -> UTC yarim tun (DATE ustuni uchun). */
export function parseDateOnly(value: string | Date): Date | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return utcDate(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const result = utcDate(year, month - 1, day);
  if (
    result.getUTCFullYear() !== year ||
    result.getUTCMonth() !== month - 1 ||
    result.getUTCDate() !== day
  ) {
    return null;
  }
  return result;
}

/** Toshkent kunining [boshlanish, tugash) oralig'i (UTC timestamplar). */
export function tashkentDayRange(dateOnly: Date): { from: Date; to: Date } {
  const from = new Date(dateOnly.getTime() - TASHKENT_OFFSET_MS);
  return { from, to: new Date(from.getTime() + 24 * 60 * 60 * 1000) };
}

export function todayDateOnly(now = new Date()): Date {
  const shifted = new Date(now.getTime() + TASHKENT_OFFSET_MS);
  return utcDate(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
}

/** Summani tiyinda saqlaymiz — float xatolari qarz hisobiga ta'sir qilmasin. */
export function toCents(value: string | number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100);
}

export function fromCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

function label(periodStart: Date): string {
  return periodStart.toISOString().slice(0, 10);
}

export function monthTotals(dueCents: number, paidCents: number): MonthTotals {
  return {
    due: dueCents / 100,
    paid: paidCents / 100,
    debt: Math.max(0, dueCents - paidCents) / 100,
    surplus: Math.max(0, paidCents - dueCents) / 100,
  };
}

/**
 * Qarz oy bo'yicha yig'iladi: bir oydagi ortiqcha to'lov boshqa oy qarzini
 * yopmaydi. Qaytadi: kalit (haydovchi yoki avtomobil) -> jami qarz (tiyin).
 */
export function debtByKey<Key extends string>(
  plans: Array<DatedAmount<Key>>,
  payments: Array<DatedAmount<Key>>,
): Map<Key, number> {
  const paid = new Map<string, number>();
  for (const payment of payments) {
    const key = `${payment.key}|${label(payment.periodStart)}`;
    paid.set(key, (paid.get(key) ?? 0) + toCents(payment.amount));
  }

  const debt = new Map<Key, number>();
  for (const plan of plans) {
    const key = `${plan.key}|${label(plan.periodStart)}`;
    const remaining = toCents(plan.amount) - (paid.get(key) ?? 0);
    if (remaining > 0) {
      debt.set(plan.key, (debt.get(plan.key) ?? 0) + remaining);
    }
  }
  return debt;
}

/** Oyning to'lov holati (joriy oy kartasi uchun). */
export function monthState(
  plans: Array<DatedAmount<string>>,
  payments: Array<DatedAmount<string>>,
  key: string,
  periodStart: Date,
): MonthTotals {
  const day = label(periodStart);
  const due = plans
    .filter((plan) => plan.key === key && label(plan.periodStart) === day)
    .reduce((sum, plan) => sum + toCents(plan.amount), 0);
  const paid = payments
    .filter((payment) => payment.key === key && label(payment.periodStart) === day)
    .reduce((sum, payment) => sum + toCents(payment.amount), 0);
  return monthTotals(due, paid);
}

/** Avtomobilning shaxsiy oylik normasi bo'lmasa, yo'nalish plani qo'llanadi. */
export function effectiveMonthlyFee<T extends { gt(value: number): boolean }>(vehicle: {
  monthlyFee: T;
  route?: { monthlyPlan: T } | null;
}): T {
  if (vehicle.monthlyFee.gt(0) || !vehicle.route) return vehicle.monthlyFee;
  return vehicle.route.monthlyPlan;
}
