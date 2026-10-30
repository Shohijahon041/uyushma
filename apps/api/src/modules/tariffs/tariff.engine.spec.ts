import { Prisma, TariffRuleOperation } from "@prisma/client";
import { calculateTariff } from "./tariff.engine";

const dec = (value: string) => new Prisma.Decimal(value);

function rule(
  code: string,
  operation: TariffRuleOperation,
  amount: string,
  priority: number,
) {
  return { code, label: code, operation, amount: dec(amount), priority };
}

describe("calculateTariff", () => {
  it("applies ADD then OVERRIDE in priority order", () => {
    const result = calculateTariff({
      baseAmount: dec("50000.00"),
      pricePerKm: dec("900.00"),
      distanceKm: dec("300.50"),
      rules: [
        rule("NIGHT", TariffRuleOperation.ADD, "25000.00", 10),
        rule("CORP", TariffRuleOperation.OVERRIDE, "300000.00", 20),
      ],
    });

    expect(result.distanceCharge).toBe("270450.00");
    expect(result.subtotal).toBe("320450.00");
    expect(result.total).toBe("300000.00");
    expect(result.lines.map((line) => line.code)).toEqual(["NIGHT", "CORP"]);
    expect(result.lines[0]?.after).toBe("345450.00");
    expect(result.lines[1]?.after).toBe("300000.00");
  });

  it("ADD after OVERRIDE adds to the overridden total", () => {
    const result = calculateTariff({
      baseAmount: dec("1000.00"),
      pricePerKm: dec("0"),
      distanceKm: dec("0"),
      rules: [
        rule("BASE_OVERRIDE", TariffRuleOperation.OVERRIDE, "100.00", 1),
        rule("EXTRA", TariffRuleOperation.ADD, "25.50", 2),
      ],
    });
    expect(result.total).toBe("125.50");
  });

  it("uses code as a deterministic tiebreaker for equal priorities", () => {
    const result = calculateTariff({
      baseAmount: dec("0"),
      pricePerKm: dec("0"),
      distanceKm: dec("0"),
      rules: [
        rule("B", TariffRuleOperation.ADD, "10.00", 5),
        rule("A", TariffRuleOperation.ADD, "2.00", 5),
      ],
    });
    expect(result.total).toBe("12.00");
    expect(result.lines.map((line) => line.code)).toEqual(["A", "B"]);
  });

  it("rounds distance charge half-up to 2 decimal places", () => {
    const result = calculateTariff({
      baseAmount: dec("0"),
      pricePerKm: dec("0.05"),
      distanceKm: dec("0.10"),
      rules: [],
    });
    expect(result.distanceCharge).toBe("0.01");
    expect(result.total).toBe("0.01");
  });

  it("rejects negative rule amounts", () => {
    expect(() =>
      calculateTariff({
        baseAmount: dec("0"),
        pricePerKm: dec("0"),
        distanceKm: dec("0"),
        rules: [rule("NEG", TariffRuleOperation.ADD, "-1.00", 1)],
      }),
    ).toThrow(/manfiy/);
  });
});
