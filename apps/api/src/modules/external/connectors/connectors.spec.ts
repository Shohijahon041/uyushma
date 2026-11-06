import { AutoparkConnector, chooseProfile } from "./autopark.connector";
import { EtenderConnector } from "./etender.connector";
import { IjaraConnector } from "./ijara.connector";
import { formatPlateDisplay } from "./mapping";

describe("formatPlateDisplay", () => {
  it("renders Uzbek plate numbers in the official layout", () => {
    expect(formatPlateDisplay("60A125UA")).toBe("60 A 125 UA");
    expect(formatPlateDisplay("01 a 123 bc")).toBe("01 A 123 BC");
    expect(formatPlateDisplay("A125BC")).toBe("A 125 BC");
    expect(formatPlateDisplay("")).toBe("");
  });
});

type Handler = (url: URL, method: string, init?: RequestInit) => unknown | Promise<unknown>;

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    headers: new Headers({ "content-type": "application/json" }),
  } as unknown as Response;
}

function installFetch(handler: Handler) {
  const mock = jest.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = (init?.method ?? "GET").toUpperCase();
    const result = await handler(url, method, init);
    if (typeof (result as { text?: unknown })?.text === "function") {
      return result as Response;
    }
    return jsonResponse(result);
  });
  global.fetch = mock as unknown as typeof fetch;
  return mock;
}

function requestBody(init?: RequestInit): Record<string, unknown> {
  try {
    return JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

afterEach(() => {
  jest.restoreAllMocks();
});

const token = "test-token-0123456789";

// Shapes copied from the live e-tender API (2026-10).
const direction = {
  id: 3216,
  name: "Узумзор автостанцияси-Иттифоқ",
  pass_number: "369",
  dir_type: "taxi",
};
const contract = {
  id: 67277,
  number: "1737/3",
  date: "2026-07-07",
  exp_date: "2027-07-07",
  status: "deactivated",
  type: "new",
  directions: [direction],
};
const appealCar = {
  car_id: "1327772",
  auto_number: "60A613CB",
  year: 2023,
  ownership: "tax",
  tech_seria: "AAG",
  tech_number: "2543403",
  seat_qty: 6,
  gai: {
    Vehicle: [
      {
        pModel: "DAMAS 2",
        pKuzov: "XWB7T12YDPP878238",
        pYear: 2023,
        pSeats: 7,
      },
    ],
  },
};
const paginator = (data: unknown[], lastPage = 1, total = data.length) => ({
  success: true,
  result: { current_page: 1, last_page: lastPage, per_page: 12, total, data },
});

describe("EtenderConnector", () => {
  const connector = new EtenderConnector();

  function defaultHandler(url: URL, method: string, init?: RequestInit): unknown {
    switch (url.pathname) {
      case "/api/profile":
        return {
          result: {
            permissions: ["cars"],
            user: { company_name: "MCHJ Test", inn: "313054621" },
          },
        };
      case "/api/user/get-cars":
        return {
          success: true,
          result: [
            {
              automobile_number: "60C331EB",
              mark_name: "DAMAS-2",
              seats_tonnage: "6.00",
              year_of_auto: 2025,
              type_of_vehicle: "Легковой",
              card_number: "OLD-CARD",
              card_start_date: 1793127600,
              card_end_date: 1799521200,
              inn: "313054621",
            },
          ],
        };
      case "/api/report/car-report": {
        expect(method).toBe("POST");
        const body = requestBody(init);
        expect(body.auto_number).toBe("");
        const items =
          body.page === 2
            ? [
                {
                  auto_number: "70A000AA",
                  license_number: "L-70",
                  license_exp_date: "31.12.2027",
                  direction_name: "Бошқа йўналиш",
                  direction_number: "1",
                },
              ]
            : [
                {
                  auto_number: "60C331EB",
                  license_number: "10596030",
                  license_start_date: "2026-10-28",
                  license_exp_date: "2027-01-10",
                  direction_name: "Пахтаобод-Бўстон",
                  direction_number: "463",
                  tclass: '"M" Класс (Damas ва бошқа)',
                  gai: { pMarka: "DAMAS-2", pPlateNumber: "60C331EB" },
                },
              ];
        return {
          success: true,
          result: {
            success: true,
            total_count: 2,
            result: { current_page: body.page ?? 1, last_page: 2, total: 2, data: items },
          },
        };
      }
      case "/api/contract/user/appeal":
        expect(method).toBe("POST");
        return paginator([
          {
            id: 47804,
            type: "change",
            status: "completed",
            company_name: "MCHJ Test",
            date: "2026-10-28 14:20:05",
            region_id: 4,
            user: { company_name: "MCHJ Test", phone: "+998 90 000 00 00" },
            contract,
            cars: [appealCar],
            new_cars: [],
            removed_cars: null,
          },
        ]);
      case "/api/contract/user":
        expect(method).toBe("POST");
        return paginator([
          {
            id: 67297,
            number: "1737/4",
            status: "completed",
            type: "new",
            date: "2026-07-07",
            exp_date: "2027-07-07",
            accepted_date: "2026-07-07",
            items: [{ direction }],
            cars: [],
            user: { company_name: "MCHJ Test", inn: "313054621" },
          },
        ]);
      case "/api/certificate/user":
        expect(method).toBe("POST");
        return paginator([
          {
            id: 1282198,
            seria: "AB",
            number: "246543",
            status: "active",
            company_name: "MCHJ Test",
            car_id: 1328489,
            exp_date: "2027-07-07",
            created_at: "2026-10-28T12:32:03.000000Z",
            user: { bank_number: "20208000907471356001", phone: "+998 90 000 00 00" },
            direction,
            car: {
              id: 1328489,
              auto_number: "60A125UA",
              gai: { pPlateNumber: "60A125UA", pMarka: "DAMAS" },
            },
          },
        ]);
      case "/api/application/user":
        expect(method).toBe("POST");
        return paginator([
          {
            id: 58163,
            status: "winner",
            tender_status: "winner",
            created_at: "2026-10-28T12:32:00.000000Z",
            contract_id: 62390,
            lots: { id: 45347, items: [{ direction }] },
            user: { company_name: "MCHJ Test" },
          },
        ]);
      default:
        throw new Error(`unexpected ${method} ${url.pathname}`);
    }
  }

  it("collects the fleet, licence report, records and attached cars", async () => {
    const fetchMock = installFetch(defaultHandler);
    const result = await connector.fetchAll(
      "https://e-tenderapi.uztrans.uz",
      token,
      {},
    );

    expect(result.warnings).toEqual([]);

    const plates = result.vehicles.map((item) => item.plateNumber).sort();
    expect(plates).toEqual(["60A125UA", "60A613CB", "60C331EB", "70A000AA"]);

    const fleet = result.vehicles.find((item) => item.plateNumber === "60C331EB")!;
    expect(fleet.externalId).toBe("plate:60C331EB");
    expect(fleet.organizationName).toBe("MCHJ Test");
    expect(fleet.licenseNumber).toBe("10596030");
    expect(fleet.licenseExpiresAt?.getFullYear()).toBe(2027);
    expect(fleet.routeName).toBe("Пахтаобод-Бўстон");
    expect(fleet.routeNumber).toBe("463");
    expect(fleet.vehicleModel).toBe("DAMAS-2");
    expect(fleet.vehicleClass).toBe("Легковой");

    const attached = result.vehicles.find((item) => item.plateNumber === "60A613CB")!;
    expect(attached.routeName).toBe(direction.name);
    expect(attached.routeNumber).toBe("369");
    expect(attached.vin).toBe("XWB7T12YDPP878238");
    expect(attached.vehicleModel).toBe("DAMAS 2");

    const certificateCar = result.vehicles.find(
      (item) => item.plateNumber === "60A125UA",
    )!;
    expect(certificateCar.vehicleModel).toBe("DAMAS");
    expect(certificateCar.routeName).toBe(direction.name);

    const byKind = (kind: string) =>
      result.records.filter((item) => item.kind === kind);
    expect(byKind("CONTRACT_APPLICATION")).toHaveLength(1);
    expect(byKind("CONTRACT")).toHaveLength(1);
    expect(byKind("CERTIFICATE")).toHaveLength(1);
    expect(byKind("TENDER_APPLICATION")).toHaveLength(1);

    const application = byKind("CONTRACT_APPLICATION")[0]!;
    expect(application.number).toBe("1737/3");
    expect(application.title).toBe(direction.name);
    expect(application.status).toBe("completed");
    expect(application.startsAt?.getFullYear()).toBe(2026);
    expect(application.expiresAt?.getFullYear()).toBe(2027);

    const certificate = byKind("CERTIFICATE")[0]!;
    expect(certificate.number).toBe("AB 246543");
    expect(certificate.title).toBe(direction.name);
    expect(certificate.expiresAt?.getFullYear()).toBe(2027);
    // Provider user tables (bank account, phone) stay out of our storage.
    expect((certificate.raw as Record<string, unknown>).user).toBeUndefined();
    expect((application.raw as Record<string, unknown>).user).toBeUndefined();

    const contractRecord = byKind("CONTRACT")[0]!;
    expect(contractRecord.number).toBe("1737/4");
    expect(contractRecord.title).toBe(direction.name);

    const tender = byKind("TENDER_APPLICATION")[0]!;
    expect(tender.status).toBe("winner");
    expect(tender.title).toBe(direction.name);

    const authHeaders = fetchMock.mock.calls.map(
      (call) => (call[1] as RequestInit).headers as Record<string, string>,
    );
    expect(authHeaders.every((headers) => headers.Authorization === `Bearer ${token}`)).toBe(true);
  });

  it("surfaces HTTP-200 access errors as warnings instead of silent zeros", async () => {
    installFetch((url, _method, init) => {
      if (url.pathname === "/api/profile") {
        return { result: { user: { company_name: "MCHJ" } } };
      }
      if (url.pathname === "/api/certificate/user") {
        return { error: true, message: "Access denied" };
      }
      if (url.pathname === "/api/report/car-report") {
        return { success: true, result: { success: true, result: { data: [] } } };
      }
      if (url.pathname === "/api/user/get-cars") return { result: [] };
      if (url.pathname === "/api/contract/user/appeal") return paginator([]);
      if (url.pathname === "/api/contract/user") return paginator([]);
      if (url.pathname === "/api/application/user") return paginator([]);
      throw new Error(`unexpected ${_method} ${url.pathname} ${init?.body ?? ""}`);
    });

    const result = await connector.fetchAll(
      "https://e-tenderapi.uztrans.uz",
      token,
      {},
    );
    expect(result.warnings.join(" ")).toContain("Guvohnomalar: Access denied");
    expect(result.records).toEqual([]);
  });

  it("fails fast when the token is rejected", async () => {
    installFetch(() => jsonResponse({ message: "Unauthorized" }, 401));
    await expect(
      connector.fetchAll("https://e-tenderapi.uztrans.uz", token, {}),
    ).rejects.toThrow(/Token yaroqsiz/);
  });

  it("verifies the token via the profile user block", async () => {
    installFetch(() => ({
      result: { permissions: [], user: { company_name: "MCHJ Test" } },
    }));
    await expect(connector.test("https://e-tenderapi.uztrans.uz", token)).resolves.toEqual({
      account: "MCHJ Test",
    });
  });

  it("logs in with One ID INN and password", async () => {
    const fetchMock = installFetch((url, method) => {
      expect(url.pathname).toBe("/api/login");
      expect(method).toBe("POST");
      return { success: true, token: "oneid-token" };
    });

    const result = await connector.login(
      "https://e-tenderapi.uztrans.uz",
      { username: "301234567", password: "secret-pass", ip: "1.2.3.4" },
      {},
    );
    expect(result.token).toBe("oneid-token");
    expect(result.account).toBeNull();

    const body = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit).body),
    ) as Record<string, string>;
    expect(body).toEqual({
      inn: "301234567",
      password: "secret-pass",
      ip: "1.2.3.4",
    });
    expect(
      ((fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>)
        .Authorization,
    ).toBeUndefined();
  });

  it("reports blocked or wrong One ID credentials", async () => {
    installFetch(() => ({
      error: true,
      message: "Вход в систему с логином и паролем заблокирован",
    }));
    await expect(
      connector.login(
        "https://e-tenderapi.uztrans.uz",
        { username: "301234567", password: "wrong" },
        {},
      ),
    ).rejects.toThrow(/Вход в систему с логином и паролем заблокирован/);
  });
});

describe("AutoparkConnector", () => {
  const connector = new AutoparkConnector();

  it("walks the route tree of the token's organisation and lists vehicles and drivers", async () => {
    const claims = Buffer.from(JSON.stringify({ organizationId: "org-1" })).toString("base64url");
    const orgToken = `h.${claims}.s`;
    const tree = [
      {
        id: "region-1",
        name: "Toshkent",
        entityType: "REGION",
        children: [
          {
            id: "org-1",
            name: "CARLUX MCHJ",
            entityType: "ORGANIZATION",
            children: [
              {
                id: "park-1",
                name: "Park",
                entityType: "PARK",
                children: [{ id: "rv-1", name: "B-11", entityType: "ROUTE", children: [] }],
              },
            ],
          },
          {
            id: "org-2",
            name: "Boshqa",
            entityType: "ORGANIZATION",
            children: [{ id: "rv-9", name: "X-1", entityType: "ROUTE" }],
          },
        ],
      },
    ];
    const fetchMock = installFetch((url, method) => {
      const path = url.pathname;
      if (method === "POST" && path.endsWith("/vehicles")) {
        return jsonResponse({ message: "METHOD_NOT_ALLOWED" }, 405);
      }
      if (path.endsWith("/account-authorities")) return { data: { orgName: "CARLUX MCHJ" } };
      if (path === "/route-management/api/v1/route-variants/tree") {
        return url.searchParams.get("isBrutto") === "false" ? { data: tree } : { data: [] };
      }
      if (path === "/non-brutto-management/api/v1/vehicles/by-route-variant/rv-1") {
        return jsonResponse({ message: "METHOD_NOT_ALLOWED" }, 405);
      }
      if (path === "/brutto-management/api/v1/vehicles/by-route-variant/rv-1") {
        return { data: [{ vehicleId: "v-1", plateNum: "01 A 123 BC", vehicleModel: "Isuzu" }] };
      }
      if (path === "/non-brutto-management/api/v1/drivers/by-route-variant/rv-1") {
        return jsonResponse({}, 404);
      }
      if (path === "/brutto-management/api/v1/drivers/by-route-variant/rv-1") {
        return { data: { content: [{ id: "d-1", fullName: "Aliyev Vali" }] } };
      }
      if (path === "/brutto-management/api/v1/drivers") return { data: { content: [] } };
      if (path === "/brutto-management/api/v1/drivers/d-1") {
        return {
          data: {
            id: "d-1",
            fullName: "Aliyev Vali",
            phoneNumber: "90 123 45 67",
            pinfl: "12345678901234",
            licenseNumber: "AF1234567",
            category: "B,D",
          },
        };
      }
      throw new Error(`unexpected ${path}`);
    });

    const result = await connector.fetchAll("https://bmapi.dtransport.uz", orgToken, {});

    expect(result.routeNames).toEqual(["B-11"]);
    expect(result.vehicles).toHaveLength(1);
    expect(result.vehicles[0]).toMatchObject({
      externalId: "v-1",
      plateNumber: "01 A 123 BC",
      routeName: "B-11",
      organizationName: "CARLUX MCHJ",
    });
    expect(result.drivers).toEqual([
      expect.objectContaining({
        externalId: "d-1",
        phone: "+998901234567",
        pinfl: "12345678901234",
        licenseCategories: "B,D",
        routeName: "B-11",
      }),
    ]);
    expect(result.warnings).toEqual([]);
    const paths = fetchMock.mock.calls.map((call) => new URL(String(call[0])).pathname);
    expect(paths.some((path) => path.includes("rv-9"))).toBe(false);
  });

  it("pages through the legacy GET autopark list and maps columns", async () => {
    const fetchMock = installFetch((url, method) => {
      if (method === "POST") return jsonResponse({ message: "METHOD_NOT_ALLOWED" }, 405);
      if (url.pathname === "/user-management/api/v1/user-profile/account-authorities") {
        return { code: 200, data: { orgName: "Avtopark MCHJ", fullName: "Dispetcher" } };
      }
      const page = Number(url.searchParams.get("page"));
      if (page === 0) {
        return {
          data: [
            {
              id: "veh-1",
              plateNumber: "01A123BC",
              garageNumber: "0042",
              vin: "VIN-1",
              gpsImei: "860000000000002",
              routeVariantName: "Toshkent—Nukus",
              routeVariantNumber: "501",
            },
          ],
        };
      }
      if (page === 1) {
        return { data: [{ id: "veh-2", plateNumber: "01A456BC" }] };
      }
      return { data: [] };
    });

    const result = await connector.fetchAll(
      "https://bmapi.dtransport.uz",
      token,
      { pageSize: 1 },
    );

    expect(result.vehicles).toHaveLength(2);
    expect(result.vehicles[0]?.garageNumber).toBe("0042");
    expect(result.vehicles[0]?.organizationName).toBe("Avtopark MCHJ");
    expect(result.vehicles[1]?.organizationName).toBe("Avtopark MCHJ");
    expect(result.records).toEqual([]);
    expect(result.warnings).toEqual([]);

    const requestedPages = fetchMock.mock.calls
      .filter((call) => (call[1]?.method ?? "GET") === "GET")
      .map((call) => new URL(String(call[0])).searchParams.get("page"))
      .filter(Boolean);
    expect(requestedPages).toEqual(["0", "1", "2"]);
  });

  it("keeps partial data when a later page fails", async () => {
    installFetch((url, method) => {
      if (method === "POST") return jsonResponse({ message: "METHOD_NOT_ALLOWED" }, 405);
      if (url.pathname === "/user-management/api/v1/user-profile/account-authorities") {
        return { data: { organizationName: "Avtopark" } };
      }
      const page = Number(url.searchParams.get("page"));
      if (page === 0) return { data: [{ id: "veh-1", plateNumber: "01A123BC" }] };
      return jsonResponse({ message: "boom" }, 500);
    });

    const result = await connector.fetchAll(
      "https://bmapi.dtransport.uz",
      token,
      { pageSize: 1 },
    );
    expect(result.vehicles).toHaveLength(1);
    expect(result.warnings.join(" ")).toContain("2-sahifa");
  });

  it("fails fast when the token is rejected (401)", async () => {
    const fetchMock = installFetch((url) => {
      if (url.pathname === "/user-management/api/v1/user-profile/account-authorities") {
        return jsonResponse({ message: "Unauthorized" }, 401);
      }
      return { data: [] };
    });
    await expect(
      connector.fetchAll("https://bmapi.dtransport.uz", token, {}),
    ).rejects.toThrow(/HTTP 401/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports a role that can read no autopark data (403 everywhere)", async () => {
    installFetch(() => jsonResponse({ code: 403, message: "FORBIDDEN", data: "Access Denied" }, 403));
    await expect(
      connector.fetchAll("https://bmapi.dtransport.uz", token, {}),
    ).rejects.toThrow(/avtopark ma'lumotlari yopiq/);
  });

  // Shapes copied from the live BM API for a non-brutto carrier (2026-10).
  it("reads the organisation-wide POST list even when per-route endpoints are forbidden", async () => {
    const fetchMock = installFetch((url, method) => {
      const path = url.pathname;
      if (path.endsWith("/account-authorities")) {
        return { data: { orgName: "\"CARLUX\" MCHJ", authorities: ["NB_AUTOPARK_VEHICLES"] } };
      }
      if (path === "/route-management/api/v1/route-variants/tree") {
        return url.searchParams.get("isBrutto") === "false"
          ? { data: [{ id: "r", entityType: "REGION", name: "Andijon", children: [{ id: "o", entityType: "ORG", name: "\"CARLUX\" MCHJ", children: [{ id: "rv-369", entityType: "ROUTE", name: "369", children: [] }] }] }] }
          : { data: [] };
      }
      if (path.includes("/by-route-variant/")) {
        return jsonResponse({ code: 403, message: "FORBIDDEN", data: "Access Denied" }, 403);
      }
      if (method === "POST" && path === "/non-brutto-management/api/v1/vehicles") {
        return {
          code: null,
          data: {
            content: [
              {
                id: "veh-1",
                tenderId: 1328475,
                status: "ACTIVE",
                plateNumber: "60A613CB",
                routeVariantNumber: "369",
                routeVariantName: "Узумзор автостанцияси-Иттифоқ",
                routeVariantId: "rv-369",
                gpsImei: null,
                organizationName: "\"CARLUX\" MCHJ",
                vehicleModel: "ZK6118",
                vehicleClass: "\"M\"",
                garageNumber: null,
              },
            ],
            page: { size: 200, number: 0, totalElements: 1, totalPages: 1 },
          },
        };
      }
      if (method === "POST" && path === "/brutto-management/api/v1/vehicles") {
        return { data: { content: [], page: { totalElements: 0, totalPages: 0 } } };
      }
      if (path === "/non-brutto-management/api/v1/drivers") {
        return { data: { content: [], page: { totalElements: 0, totalPages: 0 } } };
      }
      throw new Error(`unexpected ${method} ${path}`);
    });

    const result = await connector.fetchAll("https://bmapi.dtransport.uz", token, {});

    expect(result.vehicles).toEqual([
      expect.objectContaining({
        externalId: "veh-1",
        plateNumber: "60A613CB",
        routeName: "Узумзор автостанцияси-Иттифоқ",
        routeNumber: "369",
      }),
    ]);
    expect(result.warnings).toEqual([]);
    const paths = fetchMock.mock.calls.map((call) => new URL(String(call[0])).pathname);
    expect(paths.some((path) => path.includes("/by-route-variant/"))).toBe(false);
  });

  it("logs in with BM username and password", async () => {
    const fetchMock = installFetch((url, method) => {
      if (url.pathname === "/user-management/api/v1/user-profile/login") {
        expect(method).toBe("POST");
        return { access_token: "bm-token", refresh_token: "bm-refresh" };
      }
      if (url.pathname === "/user-management/api/v1/user-profile/account-authorities") {
        return { data: { organizationName: "Avtopark MCHJ" } };
      }
      throw new Error(`unexpected ${method} ${url.pathname}`);
    });

    const result = await connector.login(
      "https://bmapi.dtransport.uz",
      { username: "dispatcher", password: "bm-pass" },
      {},
    );
    expect(result.token).toBe("bm-token");
    expect(result.account).toBe("Avtopark MCHJ");

    const body = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit).body),
    ) as Record<string, string>;
    expect(body).toEqual({ username: "dispatcher", password: "bm-pass" });
  });

  it("reports rejected BM credentials", async () => {
    installFetch(() => jsonResponse({ message: "UNAUTHORIZED" }, 401));
    await expect(
      connector.login(
        "https://bmapi.dtransport.uz",
        { username: "dispatcher", password: "wrong" },
        {},
      ),
    ).rejects.toThrow(/BM login yoki parol xato/);
  });

  it("matches the target company despite legal-form suffixes", () => {
    const profiles = [
      { id: "p1", organizationName: '"MARDON AVTO SERVIS" MCHJ' },
      { id: "p2", organizationName: '"CAR LUX" MCHJ' },
    ];
    expect(chooseProfile(profiles, { organizationName: "CARLUX" })?.id).toBe("p2");
    expect(chooseProfile(profiles, { organizationName: "MARDON AVTO SERVIS" })?.id).toBe("p1");
    expect(chooseProfile(profiles, { organizationName: "Noma'lum" })).toBeNull();
    expect(chooseProfile(profiles, { profileId: "p1" })?.id).toBe("p1");
  });

  it("switches to the configured profile after OneID login", async () => {
    const fetchMock = installFetch((url, method) => {
      if (
        method === "POST" &&
        url.pathname === "/user-management/api/v1/user-profile/login-via-oneid/profiles"
      ) {
        return {
          data: {
            token: { access_token: "default-token" },
            profiles: [
              { id: "p1", organizationName: '"MARDON AVTO SERVIS" MCHJ' },
              { id: "p2", organizationName: '"CAR LUX" MCHJ' },
            ],
          },
        };
      }
      if (
        method === "POST" &&
        url.pathname === "/user-management/api/v1/user-profile/get-token-by-profile/p2"
      ) {
        return { access_token: "carlux-token" };
      }
      throw new Error(`unexpected ${method} ${url.pathname}`);
    });

    const result = await connector.login(
      "https://bmapi.dtransport.uz",
      { code: "one-code" },
      { organizationName: "CARLUX" },
    );

    expect(result.token).toBe("carlux-token");
    expect(result.account).toBe('"CAR LUX" MCHJ');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("switches profiles returned by the password login response", async () => {
    installFetch((url, method) => {
      if (url.pathname === "/user-management/api/v1/user-profile/login" && method === "POST") {
        return {
          access_token: "default-token",
          data: {
            profiles: [
              { id: "p1", organizationName: '"MARDON AVTO SERVIS" MCHJ' },
              { id: "p2", organizationName: '"CAR LUX" MCHJ' },
            ],
          },
        };
      }
      if (
        method === "POST" &&
        url.pathname === "/user-management/api/v1/user-profile/get-token-by-profile/p2"
      ) {
        return { access_token: "carlux-token" };
      }
      throw new Error(`unexpected ${method} ${url.pathname}`);
    });

    const result = await connector.login(
      "https://bmapi.dtransport.uz",
      { username: "dispatcher", password: "bm-pass" },
      { organizationName: "CARLUX" },
    );

    expect(result.token).toBe("carlux-token");
    expect(result.account).toBe('"CAR LUX" MCHJ');
  });

  it("renews an expired BM session and returns the rotated refresh token", async () => {
    const fetchMock = installFetch((url, method) => {
      if (
        method === "POST" &&
        url.pathname === "/user-management/api/v1/user-profile/refresh-token"
      ) {
        return {
          data: { access_token: "fresh-token", refresh_token: "fresh-refresh" },
        };
      }
      throw new Error(`unexpected ${method} ${url.pathname}`);
    });

    const result = await connector.refresh(
      "https://bmapi.dtransport.uz",
      "old-refresh",
    );

    expect(result).toEqual({
      token: "fresh-token",
      refreshToken: "fresh-refresh",
    });
    const body = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit).body),
    ) as Record<string, string>;
    expect(body).toEqual({ refreshToken: "old-refresh" });
  });
});

describe("IjaraConnector", () => {
  const connector = new IjaraConnector();

  it("authenticates via login endpoint", async () => {
    installFetch((url, method, init) => {
      if (url.pathname === "/api/auth/oneid") {
        return {
          token: "ijara-test-token",
          company_name: "OOO Uyushma Test",
        };
      }
      throw new Error(`unexpected ${method} ${url.pathname}`);
    });

    const result = await connector.login(
      "https://ijara.soliq.uz",
      { username: "313054621", password: "secret-password" },
      {},
    );

    expect(result.token).toBe("ijara-test-token");
    expect(result.account).toBe("OOO Uyushma Test");
  });

  it("fetches car rental list and parses vehicles and contracts", async () => {
    installFetch((url, method) => {
      if (url.pathname === "/api/user/profile") {
        return { name: "OOO Samarqand Yo'lovchi Trans" };
      }
      if (
        url.pathname === "/api/transport-rent/client/transport-rent/contract/get-list/by-params" ||
        url.pathname === "/api/car/renting/list" ||
        url.pathname === "/car/renting/list"
      ) {
        return {
          data: [
            {
              id: 4586059,
              contract_number: "4586059",
              start_date: "31.10.2026",
              end_date: "10.01.2027",
              car_number: "01 A 123 AA",
              car_model: "Chevrolet Cobalt",
              car_vin: "XWB1234567890",
              lessor_name: "OOO Samarqand Yo'lovchi Trans",
              lessee_name: "Aliyev Vali",
              lessee_pinfl: "31234567890123",
              lessee_phone: "+998901234567",
              rent_amount: "4000000",
            },
          ],
        };
      }
      throw new Error(`unexpected ${method} ${url.pathname}`);
    });

    const result = await connector.fetchAll("https://ijara.soliq.uz", "token-123", {});

    expect(result.vehicles).toHaveLength(1);
    expect(result.vehicles[0]?.plateNumber).toBe("01 A 123 AA");
    expect(result.vehicles[0]?.vin).toBe("XWB1234567890");
    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.kind).toBe("RENT_CONTRACT");
    expect(result.records[0]?.externalId).toBe("4586059");
    expect((result.records[0]?.raw as any)?.contractViewUrl).toBe(
      "https://ijara.soliq.uz/car/contract-view/4586059/31.10.2026/10.01.2027",
    );
    expect(result.drivers).toHaveLength(1);
    expect(result.drivers?.[0]?.fullName).toBe("Aliyev Vali");
    expect(result.drivers?.[0]?.pinfl).toBe("31234567890123");
  });
});
