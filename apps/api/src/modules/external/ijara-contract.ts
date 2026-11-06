import { normalizePlate } from "./connectors/mapping";

type RecordLike = {
  raw: unknown;
  number: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  syncedAt: Date;
};

type VehicleLike = {
  raw: unknown;
  syncedAt: Date;
};

type AnyRecord = Record<string, unknown>;

function asRecord(value: unknown): AnyRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as AnyRecord)
    : {};
}

/**
 * Demo contracts were generated locally with the "IJ-YYYY/NNNN" number and a
 * fixed 1 January period. They were never confirmed by ijara.soliq.uz, so they
 * must never satisfy a compliance or QR-passport check.
 */
export function isDemoIjaraRecord(record: RecordLike): boolean {
  const raw = asRecord(record.raw);
  if (raw.demo === true || raw.seeded === true) return true;
  const number = String(raw.contract_number ?? raw.contractNumber ?? record.number ?? "").trim();
  const start = String(raw.start_date ?? "").trim();
  const end = String(raw.end_date ?? "").trim();
  return (
    /^IJ-\d{4}\//i.test(number) &&
    /^01\.01\.\d{4}$/.test(start) &&
    /^01\.01\.\d{4}$/.test(end)
  );
}

export function isDemoIjaraVehicle(vehicle: VehicleLike): boolean {
  const raw = asRecord(vehicle.raw);
  if (raw.demo === true || raw.seeded === true) return true;
  const number = String(raw.contract_number ?? raw.contractNumber ?? "").trim();
  const start = String(raw.start_date ?? "").trim();
  return /^IJ-\d{4}\//i.test(number) && /^01\.01\.\d{4}$/.test(start);
}

function compareRecords(a: RecordLike, b: RecordLike): number {
  const startDiff = (a.startsAt?.getTime() ?? 0) - (b.startsAt?.getTime() ?? 0);
  if (startDiff !== 0) return startDiff;
  return a.syncedAt.getTime() - b.syncedAt.getTime();
}

/**
 * Picks the contract a vehicle should be judged by: an active real contract
 * first (newest start wins), otherwise the most recent real contract even if
 * it already expired.
 */
export function pickIjaraRecord<T extends RecordLike>(
  records: readonly T[],
  nowMs = Date.now(),
): T | null {
  const real = records.filter((record) => !isDemoIjaraRecord(record));
  if (real.length === 0) return null;
  const active = real.filter((record) => !record.endsAt || record.endsAt.getTime() >= nowMs);
  return (active.length > 0 ? active : real).reduce<T | null>(
    (best, record) =>
      best === null || compareRecords(record, best) > 0 ? record : best,
    null,
  );
}

export function pickIjaraVehicle<T extends VehicleLike>(vehicles: readonly T[]): T | null {
  const real = vehicles.filter((vehicle) => !isDemoIjaraVehicle(vehicle));
  return real.reduce<T | null>(
    (best, vehicle) =>
      best === null || vehicle.syncedAt.getTime() > best.syncedAt.getTime() ? vehicle : best,
    null,
  );
}

/** Plate stored inside an ijara.soliq.uz contract/vehicle payload. */
export function ijaraPlate(raw: unknown): string {
  const row = asRecord(raw);
  const car = asRecord(row.car);
  const plate = String(
    row.vehicleNumber ??
      row.vehicle_number ??
      row.car_number ??
      row.carNumber ??
      row.plateNumber ??
      row.plate_number ??
      row.transport_number ??
      car.number ??
      car.plateNumber ??
      "",
  );
  return normalizePlate(plate);
}

/** Money fields arrive as numbers, strings and zero placeholders. */
export function positiveMoney(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed =
    typeof value === "number" ? value : Number(String(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : null;
}
