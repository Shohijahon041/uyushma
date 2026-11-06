import { dateOnlyTashkent, formatDmY } from "./connectors/mapping";
import {
  ijaraPlate,
  isDemoIjaraRecord,
  pickIjaraRecord,
  pickIjaraVehicle,
  positiveMoney,
} from "./ijara-contract";

type RecordInput = {
  raw: unknown;
  number: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  syncedAt: Date;
};

function rentRecord(overrides: Partial<RecordInput> = {}): RecordInput {
  return {
    raw: { vehicleNumber: "60A125UA" },
    number: "4494704",
    startsAt: new Date("2026-10-03T19:00:00Z"),
    endsAt: new Date("2026-12-09T19:00:00Z"),
    syncedAt: new Date("2026-11-05T11:34:18Z"),
    ...overrides,
  };
}

const demoRecord = rentRecord({
  raw: {
    vehicleNumber: "60A125UA",
    contract_number: "IJ-2026/0002",
    start_date: "01.01.2026",
    end_date: "01.01.2027",
  },
  number: "IJ-2026/0002",
  startsAt: new Date("2025-12-31T19:00:00Z"),
  endsAt: new Date("2026-12-31T19:00:00Z"),
  syncedAt: new Date("2026-11-05T11:33:57Z"),
});

const NOW = new Date("2026-11-05T12:00:00Z").getTime();

describe("Tashkent document dates", () => {
  it("keeps 04.10.2026 when the source stores Tashkent midnight", () => {
    const value = new Date("2026-10-03T19:00:00Z");
    expect(dateOnlyTashkent(value)).toBe("2026-10-04");
    expect(formatDmY(value)).toBe("04.10.2026");
  });
});

describe("ijara contract selection", () => {
  it("never uses a generated demo contract for compliance", () => {
    expect(isDemoIjaraRecord(demoRecord)).toBe(true);
    expect(pickIjaraRecord([demoRecord, rentRecord()], NOW)?.number).toBe("4494704");
    expect(pickIjaraRecord([demoRecord], NOW)).toBeNull();
  });

  it("prefers the newest active contract", () => {
    const older = rentRecord({
      number: "100",
      startsAt: new Date("2026-01-09T19:00:00Z"),
      endsAt: new Date("2026-12-30T19:00:00Z"),
    });
    expect(pickIjaraRecord([older, rentRecord()], NOW)?.number).toBe("4494704");
  });

  it("falls back to the latest real contract when all have expired", () => {
    const old = rentRecord({
      number: "100",
      startsAt: new Date("2025-01-09T19:00:00Z"),
      endsAt: new Date("2025-06-29T19:00:00Z"),
    });
    const newer = rentRecord({
      number: "200",
      startsAt: new Date("2025-06-29T19:00:00Z"),
      endsAt: new Date("2025-12-29T19:00:00Z"),
    });
    expect(pickIjaraRecord([old, newer], NOW)?.number).toBe("200");
  });

  it("normalizes the plate inside provider payloads", () => {
    expect(ijaraPlate({ vehicleNumber: "60 a 125 ua" })).toBe("60A125UA");
    expect(ijaraPlate({ car: { number: "01 123 ABC" } })).toBe("01123ABC");
    expect(ijaraPlate({})).toBe("");
  });

  it("drops zero placeholders from money fields", () => {
    expect(positiveMoney("0")).toBeNull();
    expect(positiveMoney("0.00")).toBeNull();
    expect(positiveMoney(0)).toBeNull();
    expect(positiveMoney("3 500 000")).toBe("3500000");
    expect(positiveMoney(3500000)).toBe("3500000");
  });

  it("ignores demo ijara vehicles and keeps the newest real one", () => {
    const demoVehicle = {
      raw: { contract_number: "IJ-2026/0002", start_date: "01.01.2026" },
      syncedAt: new Date("2026-11-05T11:33:57Z"),
    };
    const realVehicle = {
      raw: { vehicleNumber: "60A125UA" },
      syncedAt: new Date("2026-11-05T11:34:18Z"),
    };
    expect(pickIjaraVehicle([demoVehicle, realVehicle])).toBe(realVehicle);
    expect(pickIjaraVehicle([demoVehicle])).toBeNull();
  });
});
