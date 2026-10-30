import { Prisma } from "@prisma/client";
import {
  debtByKey,
  effectiveMonthlyFee,
  formatPeriod,
  monthState,
  monthsBetween,
  parseDateOnly,
  parsePeriod,
  periodStartFor,
  tashkentDayRange,
  todayDateOnly,
  toCents,
  fromCents,
} from "./billing";

describe("billing helpers", () => {
  it("keeps Tashkent month boundary (UTC+5)", () => {
    // 2026-10-31 20:30 UTC = 2026-11-01 01:30 in Tashkent.
    const date = new Date("2026-10-31T20:30:00.000Z");
    expect(formatPeriod(periodStartFor(date))).toBe("2026-11");
    expect(formatPeriod(periodStartFor(new Date("2026-10-31T18:59:00.000Z")))).toBe(
      "2026-10",
    );
  });

  it("parses and validates YYYY-MM periods", () => {
    expect(formatPeriod(parsePeriod("2026-02")!)).toBe("2026-02");
    expect(parsePeriod("2026-13")).toBeNull();
    expect(parsePeriod("nope")).toBeNull();
    expect(parsePeriod(null)).toBeNull();
  });

  it("lists month starts across a year boundary", () => {
    const months = monthsBetween(
      parsePeriod("2025-11")!,
      parsePeriod("2026-02")!,
    );
    expect(months.map(formatPeriod)).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
  });

  it("treats dates in Tashkent, not UTC", () => {
    // 2026-10-30 20:00 UTC is already 2026-10-31 in Tashkent.
    expect(todayDateOnly(new Date("2026-10-30T20:00:00.000Z")).toISOString()).toBe(
      "2026-10-31T00:00:00.000Z",
    );
    const range = tashkentDayRange(new Date("2026-10-31T00:00:00.000Z"));
    expect(range.from.toISOString()).toBe("2026-10-30T19:00:00.000Z");
    expect(range.to.toISOString()).toBe("2026-10-31T19:00:00.000Z");
  });

  it("rejects impossible calendar dates", () => {
    expect(parseDateOnly("2026-02-31")).toBeNull();
    expect(parseDateOnly("2026-10-31")!.toISOString()).toBe(
      "2026-10-31T00:00:00.000Z",
    );
  });

  it("accumulates debt per month without offsetting overpayment", () => {
    const plans = [
      { key: "v1", periodStart: parsePeriod("2026-09")!, amount: 100_000 },
      { key: "v1", periodStart: parsePeriod("2026-10")!, amount: 100_000 },
      { key: "v2", periodStart: parsePeriod("2026-10")!, amount: 50_000 },
    ];
    const payments = [
      { key: "v1", periodStart: parsePeriod("2026-09")!, amount: 60_000 },
      // Oktyabrda 120 000 to'landi: sentabr qarzini yopmaydi.
      { key: "v1", periodStart: parsePeriod("2026-10")!, amount: 120_000 },
      { key: "v2", periodStart: parsePeriod("2026-10")!, amount: 20_000 },
    ];
    const debt = debtByKey(plans, payments);
    expect(debt.get("v1")).toBe(40000_00);
    expect(debt.get("v2")).toBe(30000_00);
  });

  it("describes current month due/paid/debt/surplus", () => {
    const period = parsePeriod("2026-10")!;
    const plans = [{ key: "v1", periodStart: period, amount: 100_000 }];
    const payments = [
      { key: "v1", periodStart: period, amount: 130_000 },
      { key: "v1", periodStart: parsePeriod("2026-09")!, amount: 50_000 },
    ];
    expect(monthState(plans, payments, "v1", period)).toEqual({
      due: 100_000,
      paid: 130_000,
      debt: 0,
      surplus: 30_000,
    });
    expect(monthState(plans, payments, "v1", parsePeriod("2026-09")!)).toEqual({
      due: 0,
      paid: 50_000,
      debt: 0,
      surplus: 50_000,
    });
  });

  it("rounds money to tiyin", () => {
    expect(toCents("100000.005")).toBe(10000001);
    expect(fromCents(40000_00)).toBe("40000.00");
  });

  it("falls back to the route plan when the vehicle has no own fee", () => {
    const d = (value: number) => new Prisma.Decimal(value);
    expect(effectiveMonthlyFee({ monthlyFee: d(500), route: { monthlyPlan: d(300) } }).toNumber()).toBe(500);
    expect(effectiveMonthlyFee({ monthlyFee: d(0), route: { monthlyPlan: d(300) } }).toNumber()).toBe(300);
    expect(effectiveMonthlyFee({ monthlyFee: d(0), route: null }).toNumber()).toBe(0);
  });
});
