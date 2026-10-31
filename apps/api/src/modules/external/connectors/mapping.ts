import type { NormalizedRecord, NormalizedVehicle } from "../external.types";

type AnyRecord = Record<string, unknown>;

function isRecord(value: unknown): value is AnyRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizePlate(plate: string | null | undefined): string {
  return (plate ?? "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

/** Axios payloads arrive as { data: { data: [...] } }, Laravel as { data: [...] }. */
export function extractArray(payload: unknown, depth = 0): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!isRecord(payload) || depth > 5) return [];
  const keys = [
    "data",
    "result",
    "items",
    "list",
    "rows",
    "records",
    "content",
    "vehicles",
    "cars",
  ];
  for (const key of keys) {
    const value = payload[key];
    if (Array.isArray(value)) return value;
    if (isRecord(value)) {
      const nested = extractArray(value, depth + 1);
      if (nested.length > 0) return nested;
    }
  }
  return [];
}

export function extractPagination(
  payload: unknown,
): { lastPage: number | null; total: number | null } {
  if (!isRecord(payload)) return { lastPage: null, total: null };
  // Laravel paginators sit at the root, inside data/result, or one more level
  // deep (car-report returns { result: { result: { data, last_page } } }).
  const containers: AnyRecord[] = [];
  const push = (value: unknown) => {
    if (isRecord(value) && !containers.includes(value)) containers.push(value);
  };
  push(payload);
  push(payload.data);
  push(payload.meta);
  push(payload.result);
  if (isRecord(payload.result)) {
    push(payload.result.result);
    push(payload.result.data);
    push(payload.result.meta);
  }
  if (isRecord(payload.data)) {
    push(payload.data.result);
    push(payload.data.data);
  }

  let lastPage: number | null = null;
  let total: number | null = null;
  for (const container of containers) {
    if (lastPage === null) {
      for (const key of [
        "last_page",
        "lastPage",
        "pages",
        "total_pages",
        "totalPages",
      ]) {
        const candidate = container[key];
        if (typeof candidate === "number" && Number.isFinite(candidate)) {
          lastPage = candidate;
          break;
        }
      }
    }
    if (total === null) {
      for (const key of ["total", "count", "total_count"]) {
        const candidate = container[key];
        if (typeof candidate === "number" && Number.isFinite(candidate)) {
          total = candidate;
          break;
        }
      }
    }
    if (lastPage !== null && total !== null) break;
  }
  return { lastPage, total };
}

/** e-tender answers HTTP 200 with { error: true, message } on access problems. */
export function payloadError(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  const error = payload.error;
  if (error === true) return text(payload.message) ?? "Noma'lum xato";
  if (typeof error === "string" && error.trim()) return error.trim();
  if (payload.success === false) return text(payload.message) ?? "Noma'lum xato";
  return null;
}

export function pick(source: unknown, keys: string[]): unknown {
  for (const key of keys) {
    const value = readPath(source, key);
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

/** Supports dotted fallbacks like "data.company_name" and "gai.Vehicle.0.pModel". */
function readPath(source: unknown, path: string): unknown {
  const segments = path.split(".");
  let current: unknown = source;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return undefined;
      }
      current = current[index];
      continue;
    }
    if (!isRecord(current)) return undefined;
    const normalized = new Map<string, unknown>();
    for (const [key, value] of Object.entries(current)) {
      normalized.set(key.toLowerCase(), value);
    }
    current = normalized.get(segment.toLowerCase());
  }
  return current;
}

export function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    const parts = value.map((item) => text(item)).filter(Boolean);
    return parts.length > 0 ? parts.join(", ") : null;
  }
  if (isRecord(value)) {
    return (
      text(value.name) ??
      text(value.title) ??
      text(value.fullName) ??
      text(value.label) ??
      text(value.value) ??
      null
    );
  }
  return null;
}

export function toDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number") {
    const millis = value < 1e11 ? value * 1000 : value;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const raw = String(value).trim();
  if (!raw) return null;
  const dmy = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(raw);
  const date = dmy
    ? new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]))
    : new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function externalIdOf(item: unknown, fallbackKeys: string[]): string | null {
  const value = pick(item, ["id", "uuid", "_id", ...fallbackKeys]);
  return text(value);
}

interface VehicleDefaults {
  organizationName?: string | null;
  routeName?: string | null;
  routeNumber?: string | null;
}

/**
 * Covers e-tender's three vehicle shapes: the fleet list (get-cars), the
 * licence report and the cars attached to a contract appeal/certificate.
 * The plate is used as the stable external id because get-cars has no id and
 * every other endpoint can then be merged onto the same row.
 */
export function mapEtenderVehicle(
  item: unknown,
  defaults: VehicleDefaults = {},
): NormalizedVehicle | null {
  const plate = text(
    pick(item, [
      "automobile_number",
      "auto_number",
      "plate_number",
      "plateNumber",
      "state_number",
      "number",
      "car_number",
      "gai.pPlateNumber",
      "gai.Vehicle.0.pPlateNumber",
    ]),
  );
  const externalId = plate
    ? `plate:${normalizePlate(plate)}`
    : externalIdOf(item, ["car_id", "vehicle_id", "pVehicleId"]);
  if (!externalId) return null;
  return {
    externalId,
    plateNumber: plate,
    garageNumber: text(pick(item, ["garage_number", "garageNumber"])),
    vin: text(
      pick(item, [
        "pKuzov",
        "gai.Vehicle.0.pKuzov",
        "body_number",
        "vin",
        "pBodyNumber",
      ]),
    ),
    gpsImei: text(pick(item, ["gps_imei", "imei", "gpsImei", "gps_id"])),
    organizationName:
      text(
        pick(item, [
          "company_name",
          "organization_name",
          "organizationName",
          "gai.company_name",
        ]),
      ) ??
      defaults.organizationName ??
      null,
    routeName:
      text(
        pick(item, [
          "direction_name",
          "route_name",
          "routeName",
          "direction",
          "route",
        ]),
      ) ??
      defaults.routeName ??
      null,
    routeNumber:
      text(
        pick(item, [
          "direction_number",
          "route_number",
          "routeNumber",
          "route_variant_number",
        ]),
      ) ??
      defaults.routeNumber ??
      null,
    vehicleClass: text(
      pick(item, [
        "type_of_vehicle",
        "type_of_truck",
        "tclass",
        "vehicle_class",
        "bus_type",
        "car_type",
        "gai.Vehicle.0.pBodyTypeName",
      ]),
    ),
    vehicleModel: text(
      pick(item, [
        "mark_name",
        "pModel",
        "gai.Vehicle.0.pModel",
        "gai.pMarka",
        "busmarka",
        "bus_model",
        "vehicle_model",
        "model",
        "marka",
      ]),
    ),
    drivers: pick(item, ["drivers", "driver", "driver_name"]),
    licenseNumber: text(
      pick(item, [
        "card_number",
        "license_number",
        "licence_number",
        "license",
      ]),
    ),
    licenseExpiresAt: toDate(
      pick(item, [
        "card_end_date",
        "license_exp_date",
        "license_expires_at",
        "license_expire",
        "license_valid_to",
      ]),
    ),
    raw: item,
  };
}

export function mapBmVehicle(item: unknown): NormalizedVehicle | null {
  const externalId = externalIdOf(item, ["vehicleId", "plateNumber", "plateNum"]);
  if (!externalId) return null;
  return {
    externalId,
    plateNumber: text(pick(item, ["plateNumber", "plateNum", "plate_number", "stateNumber"])),
    garageNumber: text(pick(item, ["garageNumber", "garage_number"])),
    vin: text(pick(item, ["vin", "bodyNumber"])),
    gpsImei: text(pick(item, ["gpsImei", "imei"])),
    organizationName: text(pick(item, ["organizationName", "organization", "companyName"])),
    routeName: text(pick(item, ["routeVariantName", "routeName", "route"])),
    routeNumber: text(pick(item, ["routeVariantNumber", "routeNumber"])),
    vehicleClass: text(pick(item, ["vehicleClass", "vehicleType", "busType"])),
    vehicleModel: text(pick(item, ["vehicleModel", "model"])),
    drivers: pick(item, ["drivers", "driver", "driverName"]),
    licenseNumber: text(pick(item, ["licenseNumber", "licenceNumber"])),
    licenseExpiresAt: toDate(pick(item, ["licenseExpiresAt", "licenseExpiry"])),
    raw: item,
  };
}

export function record(
  kind: NormalizedRecord["kind"],
  item: unknown,
  fallbackIdKeys: string[] = ["number", "contract_number", "certificate_number"],
): NormalizedRecord | null {
  const externalId = externalIdOf(item, fallbackIdKeys);
  if (!externalId) return null;
  return {
    kind,
    externalId,
    number: text(
      pick(item, [
        "number",
        "contract.number",
        "contract_number",
        "appeal_number",
        "certificate_number",
        "application_number",
        "tender_number",
      ]),
    ),
    title: text(
      pick(item, [
        "contract.directions.0.name",
        "items.0.direction.name",
        "lots.items.0.direction.name",
        "direction.name",
        "direction_name",
        "direction",
        "route_name",
        "title",
        "name",
        "subject",
      ]),
    ),
    status: text(
      pick(item, ["status", "tender_status", "state", "status_name", "statusName"]),
    ),
    startsAt: toDate(
      pick(item, [
        "contract.date",
        "start_date",
        "starts_at",
        "date_start",
        "startDate",
        "date",
      ]),
    ),
    endsAt: toDate(
      pick(item, [
        "contract.exp_date",
        "end_date",
        "ends_at",
        "date_end",
        "endDate",
        "exp_date",
      ]),
    ),
    issuedAt: toDate(
      pick(item, [
        "issued_at",
        "issue_date",
        "created_at",
        "date",
        "issuedAt",
        "approved_date",
      ]),
    ),
    expiresAt: toDate(
      pick(item, [
        "exp_date",
        "contract.exp_date",
        "expires_at",
        "expiry_date",
        "valid_to",
        "expiresAt",
      ]),
    ),
    raw: item,
  };
}

function slimCar(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const gai = isRecord(value.gai) ? value.gai : null;
  const gaiVehicle =
    gai && Array.isArray(gai.Vehicle) && isRecord(gai.Vehicle[0]) ? gai.Vehicle[0] : null;
  return {
    car_id: value.car_id ?? value.id ?? null,
    auto_number: value.auto_number ?? gai?.pPlateNumber ?? null,
    year: value.year ?? gaiVehicle?.pYear ?? gai?.pMadeofYear ?? null,
    model: value.busmarka ?? gaiVehicle?.pModel ?? gai?.pMarka ?? null,
    tech_seria:
      value.tech_seria ?? gaiVehicle?.pTexpassportSery ?? gai?.pTexpassportSery ?? null,
    tech_number:
      value.tech_number ??
      gaiVehicle?.pTexpassportNumber ??
      gai?.pTexpassportNumber ??
      null,
    vin: gaiVehicle?.pKuzov ?? null,
    seats: value.seat_qty ?? gaiVehicle?.pSeats ?? null,
    ownership: value.ownership ?? null,
  };
}

function slimDirections(value: unknown): unknown {
  if (!Array.isArray(value)) return undefined;
  return value.slice(0, 5).map((entry) => {
    if (!isRecord(entry)) return entry;
    return {
      id: entry.id,
      name: entry.name,
      pass_number: entry.pass_number,
      dir_type: entry.dir_type,
      distance: entry.distance,
    };
  });
}

/**
 * Keeps synced rows useful without copying the provider's user table (email,
 * phone, bank account, address) into our database.
 */
export function etenderRecordRaw(
  kind: NormalizedRecord["kind"],
  item: unknown,
): unknown {
  if (!isRecord(item)) return item;
  const contract = isRecord(item.contract) ? item.contract : null;
  const user = isRecord(item.user) ? item.user : null;
  const region = isRecord(item.region) ? item.region : null;

  switch (kind) {
    case "CONTRACT_APPLICATION":
      return {
        id: item.id,
        type: item.type,
        status: item.status,
        company_name: item.company_name,
        date: item.date,
        approved_date: item.approved_date,
        region_id: item.region_id,
        text: item.text,
        answer_text: item.answer_text,
        contract: contract
          ? {
              id: contract.id,
              number: contract.number,
              date: contract.date,
              exp_date: contract.exp_date,
              status: contract.status,
              type: contract.type,
              has_gps: contract.has_gps,
              has_license: contract.has_license,
              reject_reason: contract.reject_reason,
            }
          : undefined,
        directions: slimDirections(contract?.directions),
        cars: Array.isArray(item.cars) ? item.cars.map(slimCar) : undefined,
        new_cars: Array.isArray(item.new_cars)
          ? item.new_cars.map(slimCar)
          : undefined,
        removed_cars: Array.isArray(item.removed_cars)
          ? item.removed_cars.map(slimCar)
          : undefined,
        region: region ? { id: region.id, name: region.name } : undefined,
      };
    case "CONTRACT": {
      const firstItem =
        Array.isArray(item.items) && isRecord(item.items[0])
          ? item.items[0]
          : null;
      const direction =
        firstItem && isRecord(firstItem.direction) ? firstItem.direction : null;
      return {
        id: item.id,
        number: item.number,
        status: item.status,
        type: item.type,
        date: item.date,
        exp_date: item.exp_date,
        accepted_date: item.accepted_date,
        region_id: item.region_id,
        has_gps: item.has_gps,
        has_license: item.has_license,
        reject_reason: item.reject_reason,
        company_name: user?.company_name,
        inn: user?.inn,
        directions:
          slimDirections(item.directions) ??
          (direction ? [slimDirections([direction])] : undefined),
        cars: Array.isArray(item.cars) ? item.cars.map(slimCar) : undefined,
        region: region ? { id: region.id, name: region.name } : undefined,
      };
    }
    case "CERTIFICATE": {
      const car = isRecord(item.car) ? item.car : null;
      const direction = isRecord(item.direction) ? item.direction : null;
      return {
        id: item.id,
        seria: item.seria,
        number: item.number,
        status: item.status,
        company_name: item.company_name,
        contract_id: item.contract_id,
        car_id: item.car_id,
        issued_at: item.created_at,
        exp_date: item.exp_date,
        car: car ? slimCar(car) : undefined,
        direction: direction ? slimDirections([direction]) : undefined,
      };
    }
    case "TENDER_APPLICATION": {
      const lots = isRecord(item.lots) ? item.lots : null;
      const lotItems = lots && Array.isArray(lots.items) ? lots.items : [];
      const directionEntry =
        lotItems[0] && isRecord(lotItems[0]) && isRecord(lotItems[0].direction)
          ? lotItems[0].direction
          : null;
      return {
        id: item.id,
        status: item.status,
        tender_status: item.tender_status,
        tender_id: item.tender_id,
        lot_id: item.lot_id,
        contract_id: item.contract_id,
        total_ball: item.total_ball,
        created_at: item.created_at,
        company_name: user?.company_name,
        inn: user?.inn,
        directions: directionEntry ? slimDirections([directionEntry]) : undefined,
        tarif: item.tarif,
        qty_reys: item.qty_reys,
      };
    }
    case "RENT_CONTRACT": {
      return item;
    }
  }
}

export function formatDmY(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}.${month}.${year}`;
}

/**
 * Maps a car rental contract row from ijara.soliq.uz to NormalizedVehicle.
 */
export function mapIjaraVehicle(row: unknown): NormalizedVehicle | null {
  if (!isRecord(row)) return null;
  const plate = text(
    pick(row, [
      "vehicleNumber",
      "vehicle_number",
      "car_number",
      "carNumber",
      "plateNumber",
      "plate_number",
      "govNumber",
      "car.number",
      "transport_number",
      "car.plateNumber",
    ]),
  );
  if (!plate) return null;

  const id =
    text(pick(row, ["id", "contract_id", "contractId", "car_id"])) ??
    normalizePlate(plate);
  const vin = text(
    pick(row, ["car_vin", "vin", "car.vin", "body_number", "chassis_number"]),
  );
  const model = text(
    pick(row, ["vehicleModel", "vehicle_model", "car_model", "carModel", "model", "car.model", "marka", "car_marka"]),
  );
  const lessor = text(
    pick(row, [
      "lessor_name",
      "lessorName",
      "lessor.name",
      "company_name",
      "organization_name",
    ]),
  );
  const lesseeName = text(
    pick(row, [
      "lessee_name",
      "lesseeName",
      "lessee.name",
      "driver_name",
      "driverName",
      "client_name",
    ]),
  );
  const lesseePinfl = text(
    pick(row, ["lessee_pinfl", "lesseePinfl", "lessee.pinfl", "pinfl"]),
  );
  const lesseePhone = text(
    pick(row, ["lessee_phone", "lesseePhone", "lessee.phone", "phone"]),
  );
  const lesseeLicense = text(
    pick(row, ["lessee_license", "lesseeLicense", "license_number"]),
  );

  const drivers = lesseeName
    ? [
        {
          fullName: lesseeName,
          pinfl: lesseePinfl ?? null,
          phone: lesseePhone ?? null,
          licenseNumber: lesseeLicense ?? null,
        },
      ]
    : undefined;

  return {
    externalId: id,
    plateNumber: plate,
    garageNumber: null,
    vin,
    gpsImei: null,
    organizationName: lessor,
    routeName: null,
    routeNumber: null,
    vehicleClass: null,
    vehicleModel: model,
    drivers,
    licenseNumber: lesseeLicense,
    licenseExpiresAt: null,
    raw: row,
  };
}

/**
 * Maps a car rental contract row from ijara.soliq.uz to NormalizedRecord (kind: RENT_CONTRACT).
 */
export function mapIjaraRecord(row: unknown): NormalizedRecord | null {
  if (!isRecord(row)) return null;
  const id = text(pick(row, ["id", "contract_id", "contractId"]));
  if (!id) return null;

  const number =
    text(pick(row, ["contract_number", "contractNumber", "number", "doc_number"])) ??
    id;
  const plate = text(
    pick(row, [
      "vehicleNumber",
      "vehicle_number",
      "car_number",
      "carNumber",
      "plateNumber",
      "plate_number",
      "car.number",
      "transport_number",
    ]),
  );
  const title = plate
    ? `Ijara shartnomasi: ${plate}`
    : `Ijara shartnomasi #${number}`;

  const startsAt = toDate(
    pick(row, [
      "rentStartDate",
      "start_date",
      "startDate",
      "starts_at",
      "from_date",
      "contract_date",
    ]),
  );
  const endsAt = toDate(
    pick(row, [
      "rentEndDate",
      "end_date",
      "endDate",
      "ends_at",
      "to_date",
      "exp_date",
    ]),
  );
  const rawStatus = pick(row, ["rentState", "status_name", "statusName", "status_text", "status"]);
  const status =
    rawStatus === 1 || rawStatus === "1" || rawStatus === "ACTIVE"
      ? "ACTIVE"
      : text(rawStatus) ?? "ACTIVE";

  const startDmY = startsAt ? formatDmY(startsAt) : "";
  const endDmY = endsAt ? formatDmY(endsAt) : "";

  // Soliq ijara shartnomasini to'liq ko'rish havolasi
  const contractViewUrl =
    startDmY && endDmY
      ? `https://ijara.soliq.uz/car/contract-view/${id}/${startDmY}/${endDmY}`
      : `https://ijara.soliq.uz/car/renting/list?myRentType=1&statusGroup=1`;

  const monthlyFee = text(
    pick(row, [
      "rentMonthlyRate",
      "rent_monthly_rate",
      "rent_amount",
      "rentAmount",
      "amount",
      "monthly_amount",
      "summa",
    ]),
  );

  const rawWithUrl = {
    ...row,
    contractViewUrl,
    monthlyFee,
  };

  return {
    kind: "RENT_CONTRACT",
    externalId: id,
    number,
    title,
    status,
    startsAt,
    endsAt,
    issuedAt: startsAt,
    expiresAt: endsAt,
    raw: rawWithUrl,
  };
}
