import {
  etenderRecordRaw,
  extractArray,
  extractPagination,
  externalIdOf,
  mapBmVehicle,
  mapEtenderVehicle,
  payloadError,
  pick,
  record,
  text,
  toDate,
} from "./mapping";

describe("external mapping", () => {
  describe("extractArray", () => {
    it("unwraps axios { data: { data: [...] } }", () => {
      expect(extractArray({ data: { data: [{ id: 1 }] } })).toEqual([{ id: 1 }]);
    });

    it("unwraps laravel { data: [...] }", () => {
      expect(extractArray({ data: [{ id: 2 }] })).toEqual([{ id: 2 }]);
    });

    it("supports result/items/list keys and plain arrays", () => {
      expect(extractArray({ result: [{ id: 3 }] })).toEqual([{ id: 3 }]);
      expect(extractArray({ items: [{ id: 4 }] })).toEqual([{ id: 4 }]);
      expect(extractArray([{ id: 5 }])).toEqual([{ id: 5 }]);
    });

    it("returns [] for unexpected payloads", () => {
      expect(extractArray(null)).toEqual([]);
      expect(extractArray("text")).toEqual([]);
      expect(extractArray({ data: { ok: true } })).toEqual([]);
    });
  });

  describe("extractPagination", () => {
    it("reads last_page from the root or nested data", () => {
      expect(extractPagination({ last_page: 4 })).toEqual({ lastPage: 4, total: null });
      expect(extractPagination({ data: { last_page: 7, total: 650 } })).toEqual({
        lastPage: 7,
        total: 650,
      });
    });

    it("reads camelCase pages from meta", () => {
      expect(extractPagination({ meta: { totalPages: 3 } })).toEqual({
        lastPage: 3,
        total: null,
      });
    });

    it("returns nulls when pagination is absent", () => {
      expect(extractPagination({ data: [] })).toEqual({ lastPage: null, total: null });
    });

    it("reads paginators nested inside result.result (car report)", () => {
      expect(
        extractPagination({
          success: true,
          result: { total_count: 64, result: { last_page: 6, total: 64 } },
        }),
      ).toEqual({ lastPage: 6, total: 64 });
    });
  });

  describe("pick/text", () => {
    it("matches keys case-insensitively", () => {
      expect(pick({ PlateNumber: "01A123BC" }, ["plateNumber"])).toBe("01A123BC");
    });

    it("walks dotted paths through arrays", () => {
      expect(
        pick({ gai: { Vehicle: [{ pModel: "DAMAS 2" }] } }, [
          "gai.Vehicle.0.pModel",
        ]),
      ).toBe("DAMAS 2");
      expect(
        pick({ contract: { directions: [{ name: "Marshrut" }] } }, [
          "contract.directions.0.name",
        ]),
      ).toBe("Marshrut");
      expect(pick({ gai: { Vehicle: [] } }, ["gai.Vehicle.0.pModel"])).toBeUndefined();
    });

    it("extracts readable text from nested shapes", () => {
      expect(text({ name: "Isuzu" })).toBe("Isuzu");
      expect(text({ title: "Yo'nalish" })).toBe("Yo'nalish");
      expect(text([{ name: "Ali" }, { name: "Vali" }])).toBe("Ali, Vali");
      expect(text(42)).toBe("42");
      expect(text("   ")).toBeNull();
    });
  });

  describe("payloadError", () => {
    it("detects HTTP-200 errors", () => {
      expect(payloadError({ error: true, message: "Access denied" })).toBe(
        "Access denied",
      );
      expect(payloadError({ success: false, message: "Nope" })).toBe("Nope");
      expect(payloadError({ success: true, result: [] })).toBeNull();
      expect(payloadError([{ id: 1 }])).toBeNull();
    });
  });

  describe("toDate", () => {
    it("parses DD.MM.YYYY", () => {
      const date = toDate("31.12.2027");
      expect(date?.getFullYear()).toBe(2027);
      expect(date?.getMonth()).toBe(11);
      expect(date?.getDate()).toBe(31);
    });

    it("parses unix seconds and milliseconds", () => {
      expect(toDate(1_800_000_000)?.toISOString()).toBe(
        new Date(1_800_000_000_000).toISOString(),
      );
      expect(toDate(1_800_000_000_000)?.toISOString()).toBe(
        new Date(1_800_000_000_000).toISOString(),
      );
    });

    it("returns null for invalid input", () => {
      expect(toDate("not a date")).toBeNull();
      expect(toDate("")).toBeNull();
      expect(toDate(null)).toBeNull();
    });
  });

  describe("mapEtenderVehicle", () => {
    it("maps snake_case payload", () => {
      const vehicle = mapEtenderVehicle({
        id: 10,
        plate_number: "01 A 123 BC",
        garage_number: "G-1",
        body_number: "VIN123",
        gps_imei: "860000000000001",
        organization_name: "MCHJ Test",
        direction_name: "Toshkent—Samarqand",
        direction_number: "12",
        bus_type: "Katta",
        bus_model: "Isuzu",
        drivers: [{ name: "Ali" }],
        license_number: "L-77",
        license_valid_to: "31.12.2027",
      });
      expect(vehicle).not.toBeNull();
      expect(vehicle?.externalId).toBe("plate:01A123BC");
      expect(vehicle?.plateNumber).toBe("01 A 123 BC");
      expect(vehicle?.routeName).toBe("Toshkent—Samarqand");
      expect(vehicle?.vehicleModel).toBe("Isuzu");
      expect(vehicle?.licenseNumber).toBe("L-77");
      expect(vehicle?.licenseExpiresAt?.getFullYear()).toBe(2027);
    });

    it("maps the fleet list (get-cars) and licence report shapes", () => {
      const fleet = mapEtenderVehicle({
        automobile_number: "60C331EB",
        mark_name: "DAMAS-2",
        year_of_auto: 2025,
        type_of_vehicle: "Легковой",
        card_number: "10596030",
        card_start_date: 1793127600,
        card_end_date: 1799521200,
        inn: "313054621",
      });
      expect(fleet?.externalId).toBe("plate:60C331EB");
      expect(fleet?.vehicleModel).toBe("DAMAS-2");
      expect(fleet?.vehicleClass).toBe("Легковой");
      expect(fleet?.licenseNumber).toBe("10596030");
      expect(fleet?.licenseExpiresAt).toBeInstanceOf(Date);

      const report = mapEtenderVehicle(
        {
          auto_number: "60A613CB",
          license_number: "L-9",
          license_exp_date: "2027-01-10",
          direction_name: "Пахтаобод-Бўстон",
          direction_number: "463",
          tclass: '"M" Класс',
          gai: { pMarka: "DAMAS", pPlateNumber: "60A613CB" },
        },
        { organizationName: "MCHJ Test" },
      );
      expect(report?.externalId).toBe("plate:60A613CB");
      expect(report?.organizationName).toBe("MCHJ Test");
      expect(report?.routeNumber).toBe("463");
      expect(report?.vehicleModel).toBe("DAMAS");
      expect(report?.licenseExpiresAt?.getFullYear()).toBe(2027);
    });

    it("reads the contractor car shape with nested GAI data", () => {
      const vehicle = mapEtenderVehicle(
        {
          car_id: "1327772",
          auto_number: "60A613CB",
          year: 2023,
          tech_seria: "AAG",
          tech_number: "2543403",
          gai: {
            Vehicle: [
              { pModel: "DAMAS 2", pKuzov: "XWB7T12YDPP878238", pYear: 2023 },
            ],
          },
        },
        { routeName: "Узумзор", routeNumber: "369" },
      );
      expect(vehicle?.externalId).toBe("plate:60A613CB");
      expect(vehicle?.vin).toBe("XWB7T12YDPP878238");
      expect(vehicle?.vehicleModel).toBe("DAMAS 2");
      expect(vehicle?.routeName).toBe("Узумзор");
    });

    it("uses car_id when the plate is missing and rejects id-less items", () => {
      expect(mapEtenderVehicle({ car_id: "1327772" })?.externalId).toBe("1327772");
      expect(mapEtenderVehicle({ model: "Isuzu" })).toBeNull();
    });
  });

  describe("mapBmVehicle", () => {
    it("maps camelCase autopark payload", () => {
      const vehicle = mapBmVehicle({
        id: "veh-1",
        plateNumber: "01A123BC",
        garageNumber: "0042",
        vin: "VIN-1",
        gpsImei: "860000000000002",
        organizationName: "Avtopark MCHJ",
        routeVariantName: "Toshkent—Nukus",
        routeVariantNumber: "501",
        vehicleClass: "Ikki qavatli",
        vehicleModel: "MAN",
        drivers: [{ fullName: "Ali" }],
      });
      expect(vehicle?.externalId).toBe("veh-1");
      expect(vehicle?.garageNumber).toBe("0042");
      expect(vehicle?.routeNumber).toBe("501");
      expect(vehicle?.organizationName).toBe("Avtopark MCHJ");
    });
  });

  describe("record", () => {
    it("maps a contract application", () => {
      const item = {
        id: 501,
        appeal_number: "A-1",
        direction_name: "Toshkent—Buxoro",
        status_name: "Ko'rib chiqilmoqda",
        created_at: "01.11.2026",
      };
      const mapped = record("CONTRACT_APPLICATION", item);
      expect(mapped?.externalId).toBe("501");
      expect(mapped?.number).toBe("A-1");
      expect(mapped?.title).toBe("Toshkent—Buxoro");
      expect(mapped?.status).toBe("Ko'rib chiqilmoqda");
      expect(mapped?.issuedAt?.getFullYear()).toBe(2026);
    });

    it("maps a certificate with expiry", () => {
      const mapped = record("CERTIFICATE", {
        id: 7,
        certificate_number: "C-9",
        expiry_date: "01.01.2028",
      });
      expect(mapped?.number).toBe("C-9");
      expect(mapped?.expiresAt?.getFullYear()).toBe(2028);
    });

    it("maps a live contract appeal payload", () => {
      const mapped = record("CONTRACT_APPLICATION", {
        id: 47804,
        status: "completed",
        date: "2026-10-28 14:20:05",
        contract: {
          number: "1737/3",
          date: "2026-07-07",
          exp_date: "2027-07-07",
          directions: [{ name: "Узумзор автостанцияси", pass_number: "369" }],
        },
      });
      expect(mapped?.number).toBe("1737/3");
      expect(mapped?.title).toBe("Узумзор автостанцияси");
      expect(mapped?.startsAt?.getFullYear()).toBe(2026);
      expect(mapped?.expiresAt?.getFullYear()).toBe(2027);
    });

    it("returns null when no identifier exists", () => {
      expect(record("CONTRACT", { status: "Yangi" })).toBeNull();
    });
  });

  describe("etenderRecordRaw", () => {
    it("drops provider user tables and bloated relations", () => {
      const raw = etenderRecordRaw("CERTIFICATE", {
        id: 1,
        seria: "AB",
        number: "123",
        company_name: "MCHJ",
        user: { phone: "+998", bank_number: "123" },
        contract_car: { nested: "x" },
        car: { id: 2, auto_number: "01A123BC", gai: { pMarka: "DAMAS" } },
        direction: {
          id: 3,
          name: "Marshrut",
          pass_number: "1",
          contracts: [{}, {}],
        },
      }) as Record<string, unknown>;
      expect(raw.user).toBeUndefined();
      expect(raw.contract_car).toBeUndefined();
      expect(
        (raw.direction as Array<Record<string, unknown>>)[0]?.contracts,
      ).toBeUndefined();
      expect((raw.car as Record<string, unknown>).auto_number).toBe("01A123BC");
    });

    it("keeps contract and car summaries for appeals", () => {
      const raw = etenderRecordRaw("CONTRACT_APPLICATION", {
        id: 47804,
        status: "completed",
        company_name: "MCHJ",
        contract: {
          id: 67277,
          number: "1737/3",
          view_token: "secret",
          directions: [{ id: 1, name: "Marshrut", contracts: [1, 2, 3] }],
        },
        cars: [{ car_id: 1, auto_number: "01A123BC" }],
        new_cars: [],
        removed_cars: null,
        user: { phone: "x" },
      }) as Record<string, unknown>;
      expect(raw.user).toBeUndefined();
      expect(
        (raw.contract as Record<string, unknown>).view_token,
      ).toBeUndefined();
      expect((raw.contract as Record<string, unknown>).number).toBe("1737/3");
      expect(
        (raw.directions as Array<Record<string, unknown>>)[0]?.contracts,
      ).toBeUndefined();
      expect(
        (raw.cars as Array<Record<string, unknown>>)[0]?.auto_number,
      ).toBe("01A123BC");
    });
  });

  describe("externalIdOf", () => {
    it("prefers id and falls back to provided keys", () => {
      expect(externalIdOf({ id: 1 }, [])).toBe("1");
      expect(externalIdOf({ car_id: "abc" }, ["car_id"])).toBe("abc");
      expect(externalIdOf({}, [])).toBeNull();
    });
  });
});
