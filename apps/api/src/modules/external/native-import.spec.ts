import type { NormalizedRecord } from "./external.types";
import { collectRouteDistances, parseRouteName, seatCount } from "./native-import";

function record(raw: unknown): NormalizedRecord {
  return {
    kind: "CONTRACT_APPLICATION",
    externalId: "1",
    number: null,
    title: null,
    status: null,
    startsAt: null,
    endsAt: null,
    issuedAt: null,
    expiresAt: null,
    raw,
  };
}

describe("native import helpers", () => {
  describe("parseRouteName", () => {
    it("splits dashed direction names", () => {
      expect(parseRouteName("Пахтаобод-Бўстон")).toEqual({
        origin: "Пахтаобод",
        destination: "Бўстон",
      });
      expect(parseRouteName("Toshkent — Samarqand")).toEqual({
        origin: "Toshkent",
        destination: "Samarqand",
      });
    });

    it("keeps short or numeric suffixes with the name", () => {
      expect(parseRouteName("Qo'qon-2")).toEqual({ origin: "Qo'qon-2", destination: "" });
    });

    it("falls back to the whole name when there is no separator", () => {
      expect(parseRouteName("  Shahar ichi  ")).toEqual({
        origin: "Shahar ichi",
        destination: "",
      });
    });
  });

  describe("seatCount", () => {
    it("reads seat counts from provider shapes", () => {
      expect(seatCount({ seat_qty: 45 })).toBe(45);
      expect(seatCount({ gai: { Vehicle: [{ pSeats: 20 }] } })).toBe(20);
      expect(seatCount({ seats: "13" })).toBe(13);
      expect(seatCount({ seats_tonnage: "6.00" })).toBe(6);
      expect(seatCount({ seat_qty: 0, seats_tonnage: "15.00" })).toBe(15);
    });

    it("returns 0 for unknown or invalid values", () => {
      expect(seatCount(null)).toBe(0);
      expect(seatCount({ seat_qty: "many" })).toBe(0);
      expect(seatCount({ seat_qty: 500 })).toBe(120);
    });
  });

  describe("collectRouteDistances", () => {
    it("extracts direction distances from contract payloads", () => {
      const distances = collectRouteDistances([
        record({ directions: [{ name: "Пахтаобод-Бўстон", distance: 463 }] }),
        record({ directions: [{ name: "Пахтаобод-Бўстон", distance: "470.5" }] }),
        record({ direction: [{ name: "Toshkent—Nukus", distance: 900 }] }),
      ]);
      expect(distances.get("пахтаобод-бўстон")).toEqual({
        name: "Пахтаобод-Бўстон",
        distance: 470.5,
      });
      expect(distances.get("toshkent—nukus")?.distance).toBe(900);
    });

    it("flattens nested direction lists", () => {
      const distances = collectRouteDistances([
        record({ directions: [[{ name: "Узумзор-Иттифоқ", distance: 9.5 }]] }),
      ]);
      expect(distances.get("узумзор-иттифоқ")?.distance).toBe(9.5);
    });

    it("ignores payloads without usable distances", () => {
      expect(collectRouteDistances([record({ directions: [{ name: "X" }] })]).size).toBe(0);
      expect(collectRouteDistances([record(null)]).size).toBe(0);
    });
  });
});
