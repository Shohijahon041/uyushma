import type { NormalizedRecord } from "./external.types";

type AnyRecord = Record<string, unknown>;

function isRecord(value: unknown): value is AnyRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

/**
 * e-tender direction names are human strings ("Пахтаобод-Бўстон"). Split on
 * the separators the provider uses, but keep names like "Qo'qon-2" intact.
 */
export function parseRouteName(name: string): { origin: string; destination: string } {
  const cleaned = name.replace(/\s+/g, " ").trim();
  const spaced = cleaned.match(/^(.+?)\s*(?:—|–|→|\/| - )\s*(.+)$/);
  if (spaced) {
    return { origin: spaced[1]!.trim(), destination: spaced[2]!.trim() };
  }
  const hyphen = cleaned.match(/^(.{3,}?)-(.{3,})$/);
  if (hyphen && !/^\d+$/.test(hyphen[2]!)) {
    return { origin: hyphen[1]!.trim(), destination: hyphen[2]!.trim() };
  }
  return { origin: cleaned, destination: "" };
}

/** Seat count lives under different keys per endpoint (get-cars, cars, GAI). */
export function seatCount(raw: unknown): number {
  if (!isRecord(raw)) return 0;
  const gai = isRecord(raw.gai) ? raw.gai : null;
  const gaiVehicle =
    gai && Array.isArray(gai.Vehicle) && isRecord(gai.Vehicle[0]) ? gai.Vehicle[0] : null;
  const value =
    positiveNumber(raw.seat_qty) ??
    positiveNumber(raw.seats) ??
    positiveNumber(raw.capacity) ??
    positiveNumber(raw.seatCount) ??
    positiveNumber(raw.passengerCapacity) ??
    positiveNumber(raw.bus_seats) ??
    positiveNumber(raw.seats_tonnage) ??
    positiveNumber(gaiVehicle?.pSeats) ??
    positiveNumber(gai?.pSeats);
  if (value === null) return 0;
  return Math.min(120, Math.round(value));
}

/**
 * Contract/appeal/certificate payloads embed the direction (name + distance),
 * so imported routes can carry a real distance instead of zero. Some payloads
 * nest the list one level deeper (`directions: [[{...}]]`).
 */
export function collectRouteDistances(
  records: NormalizedRecord[],
): Map<string, { name: string; distance: number }> {
  const routes = new Map<string, { name: string; distance: number }>();
  for (const record of records) {
    if (!isRecord(record.raw)) continue;
    for (const key of ["directions", "direction"]) {
      const entries = record.raw[key];
      if (!Array.isArray(entries)) continue;
      const flat = entries.flatMap((entry) => (Array.isArray(entry) ? entry : [entry]));
      for (const entry of flat) {
        if (!isRecord(entry) || typeof entry.name !== "string") continue;
        const name = entry.name.replace(/\s+/g, " ").trim();
        const distance = positiveNumber(entry.distance);
        if (!name || distance === null) continue;
        const existing = routes.get(name.toLowerCase());
        if (!existing || distance > existing.distance) {
          routes.set(name.toLowerCase(), { name, distance });
        }
      }
    }
  }
  return routes;
}
