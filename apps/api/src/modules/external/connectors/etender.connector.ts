import type { ExternalProvider } from "@prisma/client";
import {
  extractOneIdCode,
  type ExternalConnector,
  type ExternalFetchResult,
  type LoginResult,
  type NormalizedRecord,
  type NormalizedVehicle,
  type ProviderConfig,
  type ProviderCredentials,
} from "../external.types";
import { cleanBearerToken, ExternalHttpError, externalRequestJson, isExternalAuthError } from "./http";
import {
  etenderRecordRaw,
  extractArray,
  extractPagination,
  mapEtenderVehicle,
  payloadError,
  pick,
  record,
  text,
} from "./mapping";

const DEFAULT_ENDPOINTS = {
  profile: "/api/profile",
  vehicles: "/api/user/get-cars",
  applications: "/api/contract/user/appeal",
  contracts: "/api/contract/user",
  certificates: "/api/certificate/user",
  tenders: "/api/application/user",
  carReport: "/api/report/car-report",
} as const;

/** The SPA always posts this filter body to the licence report. */
const REPORT_BODY = {
  region_id: "",
  bustype_id: "",
  tclass_id: "",
  busmarka_id: "",
  busmodel_id: "",
  number: "",
  auto_number: "",
  year: "",
  company_name: "",
  cstatus: "",
  page: 1,
  is_excell: 0,
};

const MAX_PAGES = 100;

type Method = "GET" | "POST";

function joinUrl(baseUrl: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeRaw(current: unknown, incoming: unknown): unknown {
  if (isPlainObject(current) && isPlainObject(incoming)) {
    return { ...current, ...incoming };
  }
  return incoming ?? current;
}

/**
 * e-tender.uztrans.uz REST API (Bearer). Endpoint paths come from the public
 * SPA bundle; every path can be overridden per tenant via connection config so
 * a ministry-side change does not require a redeploy.
 */
export class EtenderConnector implements ExternalConnector {
  readonly provider: ExternalProvider = "ETENDER";
  readonly defaultBaseUrl = "https://e-tenderapi.uztrans.uz";

  private endpoints(config: ProviderConfig): Record<string, string> {
    return { ...DEFAULT_ENDPOINTS, ...(config.endpoints ?? {}) };
  }

  /**
   * One ID INN + password flow used by the crm/login page. The SPA posts
   * {inn, password, ip} and gets {success, token}; a wrong pair still returns
   * HTTP 200 with {error:true, message}.
   */
  async login(
    baseUrl: string,
    credentials: ProviderCredentials,
    config: ProviderConfig,
  ): Promise<LoginResult> {
    // 1. OneID OAuth2 Authorization Code orqali kirish (one_code yoki code)
    const rawCode =
      credentials.code ||
      (credentials.username &&
      (credentials.username.includes("one_code=") ||
        credentials.username.includes("code=") ||
        credentials.username.startsWith("http"))
        ? credentials.username
        : null);

    if (rawCode) {
      const code = extractOneIdCode(rawCode);
      if (code) {
        try {
          const oneIdPayload = await externalRequestJson(joinUrl(baseUrl, "/api/oneid-login"), {
            method: "POST",
            body: { code, state: "e-tender_uztrans_uz" },
          });
          const rawToken = text(
            pick(oneIdPayload, [
              "token",
              "data.token",
              "access_token",
              "data.access_token",
              "result.token",
              "result.access_token",
            ]),
          );
          const token = cleanBearerToken(rawToken);
          if (token) {
            return {
              token,
              account: text(
                pick(oneIdPayload, [
                  "company_name",
                  "organization_name",
                  "data.company_name",
                  "user.company_name",
                ]),
              ),
            };
          }
        } catch (error) {
          if (!credentials.password) {
            throw new ExternalHttpError(
              401,
              `OneID kodi qabul qilinmadi: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      }
    }

    // 2. An'anaviy INN va One ID parol orqali kirish
    const candidatePaths = config.endpoints?.login
      ? [config.endpoints.login]
      : ["/api/login", "/api/auth/login", "/api/v1/login"];

    let payload: unknown;
    let lastError: unknown = null;

    const requestBody: Record<string, string> = {
      inn: (credentials.username ?? "").trim(),
      password: credentials.password ?? "",
    };
    if (credentials.ip?.trim()) {
      requestBody.ip = credentials.ip.trim();
    }

    for (const path of candidatePaths) {
      try {
        payload = await externalRequestJson(joinUrl(baseUrl, path), {
          method: "POST",
          body: requestBody,
        });
        if (payload) break;
      } catch (error) {
        lastError = error;
        if (isExternalAuthError(error)) {
          throw new ExternalHttpError(
            401,
            "Kirish rad etildi: One ID login yoki parol xato",
          );
        }
        // Agar 404 bo'lsa, keyingi login manzilini sinab ko'ramiz
        if (error instanceof ExternalHttpError && error.status === 404) {
          continue;
        }
        throw error;
      }
    }

    if (!payload && lastError) {
      throw lastError;
    }

    const body = (payload ?? {}) as {
      success?: boolean;
      error?: boolean;
      message?: string;
    };
    const rawToken = text(
      pick(payload, [
        "token",
        "data.token",
        "access_token",
        "data.access_token",
        "result.token",
        "result.access_token",
        "data.data.token",
        "data.data.access_token",
      ]),
    );
    const token = cleanBearerToken(rawToken);

    if (body.error || !token) {
      throw new ExternalHttpError(
        401,
        body.message?.trim()
          ? `Kirish rad etildi: ${body.message.trim()}`
          : "Kirish rad etildi: One ID login yoki parol xato",
      );
    }
    return {
      token,
      account: text(
        pick(payload, ["company_name", "organization_name", "data.company_name", "user.company_name"]),
      ),
    };
  }

  async test(
    baseUrl: string,
    token: string,
  ): Promise<{ account: string | null }> {
    const payload = await this.request(
      joinUrl(baseUrl, DEFAULT_ENDPOINTS.profile),
      { token },
    );
    const account = text(
      pick(payload, [
        "result.user.company_name",
        "data.user.company_name",
        "result.user.organization_name",
        "data.company_name",
        "company_name",
        "organization_name",
        "full_name",
        "name",
      ]),
    );
    return { account };
  }

  async fetchAll(
    baseUrl: string,
    token: string,
    config: ProviderConfig,
  ): Promise<ExternalFetchResult> {
    const endpoints = this.endpoints(config);
    const warnings: string[] = [];
    const vehicles = new Map<string, NormalizedVehicle>();
    const records: NormalizedRecord[] = [];

    const profile = await this.request(
      joinUrl(baseUrl, endpoints.profile ?? DEFAULT_ENDPOINTS.profile),
      { token },
    ).catch((error: unknown) => {
      if (isExternalAuthError(error)) throw error;
      warnings.push(`Profil: ${errorText(error)}`);
      return null;
    });
    const organizationName = text(
      pick(profile, [
        "result.user.company_name",
        "result.user.organization_name",
        "data.user.company_name",
        "data.company_name",
        "company_name",
        "organization_name",
      ]),
    );

    // Registry vehicles (the carrier's own fleet in e-tender). These rows have
    // no id — the plate is the only stable key.
    try {
      const payload = await this.request(
        joinUrl(baseUrl, endpoints.vehicles ?? DEFAULT_ENDPOINTS.vehicles),
        { token },
      );
      for (const item of extractArray(payload)) {
        this.addVehicle(vehicles, mapEtenderVehicle(item), organizationName);
      }
    } catch (error) {
      if (isExternalAuthError(error)) throw error;
      warnings.push(`Avtomobillar: ${errorText(error)}`);
    }

    // Licence report: richer plates (model, route, licence number and expiry).
    try {
      const body = {
        ...REPORT_BODY,
        ...(isPlainObject(config.reportBody) ? config.reportBody : {}),
      };
      const rows = await this.fetchPaged(
        baseUrl,
        token,
        endpoints.carReport ?? DEFAULT_ENDPOINTS.carReport,
        { method: "POST", body, pageInBody: true },
      );
      for (const item of rows) {
        this.addVehicle(vehicles, mapEtenderVehicle(item), organizationName);
      }
    } catch (error) {
      if (isExternalAuthError(error)) throw error;
      warnings.push(`Litsenziya hisoboti: ${errorText(error)}`);
    }

    const listSpecs: Array<{
      key: string;
      kind: NormalizedRecord["kind"];
      label: string;
    }> = [
      {
        key: "applications",
        kind: "CONTRACT_APPLICATION",
        label: "Shartnoma arizalari",
      },
      { key: "contracts", kind: "CONTRACT", label: "Shartnomalar" },
      { key: "certificates", kind: "CERTIFICATE", label: "Guvohnomalar" },
      { key: "tenders", kind: "TENDER_APPLICATION", label: "Tender arizalari" },
    ];

    for (const spec of listSpecs) {
      const path = endpoints[spec.key];
      if (!path) continue;
      try {
        const items = await this.fetchPaged(
          baseUrl,
          token,
          path,
          { method: "POST", body: {} },
        );
        for (const item of items) {
          const mapped = record(spec.kind, item);
          if (!mapped) continue;
          if (spec.kind === "CERTIFICATE") {
            const seria = text(pick(item, ["seria"]));
            const number = text(pick(item, ["number"]));
            if (seria && number) mapped.number = `${seria} ${number}`;
          }
          mapped.raw = etenderRecordRaw(spec.kind, item);
          records.push(mapped);
          this.collectAttachedVehicles(
            vehicles,
            spec.kind,
            item,
            organizationName,
          );
        }
      } catch (error) {
        if (isExternalAuthError(error)) throw error;
        warnings.push(`${spec.label}: ${errorText(error)}`);
      }
    }

    return { vehicles: [...vehicles.values()], records, warnings };
  }

  private async request(
    url: string,
    options: {
      token?: string;
      method?: Method | "PUT";
      body?: unknown;
    },
  ): Promise<unknown> {
    const payload = await externalRequestJson(url, options);
    // e-tender hides permission problems behind HTTP 200 + {error, message}.
    const problem = payloadError(payload);
    if (problem) throw new Error(problem);
    return payload;
  }

  private requestPage(
    baseUrl: string,
    token: string,
    path: string,
    options: { method: Method; body?: unknown; pageInBody?: boolean },
    page: number,
  ): Promise<unknown> {
    const url = joinUrl(baseUrl, path);
    if (options.method === "GET") {
      return this.request(page === 1 ? url : `${url}?page=${page}`, { token });
    }
    if (options.pageInBody) {
      const body = {
        ...(isPlainObject(options.body) ? options.body : {}),
        page,
      };
      return this.request(url, { token, method: "POST", body });
    }
    return this.request(page === 1 ? url : `${url}?page=${page}`, {
      token,
      method: "POST",
      body: options.body ?? {},
    });
  }

  private async fetchPaged(
    baseUrl: string,
    token: string,
    path: string,
    options: { method: Method; body?: unknown; pageInBody?: boolean },
  ): Promise<unknown[]> {
    const first = await this.requestPage(baseUrl, token, path, options, 1);
    const items = [...extractArray(first)];
    const { lastPage, total } = extractPagination(first);
    const estimated =
      total !== null && items.length > 0
        ? Math.ceil(total / items.length)
        : 1;
    const pages = lastPage ?? estimated;
    if (pages <= 1) return items;

    for (let page = 2; page <= Math.min(pages, MAX_PAGES); page += 1) {
      const payload = await this.requestPage(
        baseUrl,
        token,
        path,
        options,
        page,
      );
      const pageItems = extractArray(payload);
      if (pageItems.length === 0) break;
      items.push(...pageItems);
    }
    return items;
  }

  private addVehicle(
    vehicles: Map<string, NormalizedVehicle>,
    vehicle: NormalizedVehicle | null,
    organizationName: string | null,
  ): void {
    if (!vehicle) return;
    if (!vehicle.organizationName) vehicle.organizationName = organizationName;
    const existing = vehicles.get(vehicle.externalId);
    if (!existing) {
      vehicles.set(vehicle.externalId, vehicle);
      return;
    }
    existing.plateNumber ??= vehicle.plateNumber;
    existing.garageNumber ??= vehicle.garageNumber;
    existing.vin ??= vehicle.vin;
    existing.gpsImei ??= vehicle.gpsImei;
    existing.organizationName ??= vehicle.organizationName;
    existing.routeName ??= vehicle.routeName;
    existing.routeNumber ??= vehicle.routeNumber;
    existing.vehicleClass ??= vehicle.vehicleClass;
    existing.vehicleModel ??= vehicle.vehicleModel;
    if (existing.drivers == null) existing.drivers = vehicle.drivers;
    // The licence report is the source of truth for licence data.
    if (vehicle.licenseNumber) existing.licenseNumber = vehicle.licenseNumber;
    if (vehicle.licenseExpiresAt) {
      existing.licenseExpiresAt = vehicle.licenseExpiresAt;
    }
    existing.raw = mergeRaw(existing.raw, vehicle.raw);
  }

  /** Contract appeals, contracts and certificates carry the cars attached to
   * the contract — the fleet list alone does not include them. */
  private collectAttachedVehicles(
    vehicles: Map<string, NormalizedVehicle>,
    kind: NormalizedRecord["kind"],
    item: unknown,
    organizationName: string | null,
  ): void {
    if (kind === "CONTRACT_APPLICATION") {
      const routeName = text(pick(item, ["contract.directions.0.name"]));
      const routeNumber = text(
        pick(item, ["contract.directions.0.pass_number"]),
      );
      for (const key of ["cars", "new_cars"]) {
        const list = pick(item, [key]);
        if (!Array.isArray(list)) continue;
        for (const car of list) {
          this.addVehicle(
            vehicles,
            mapEtenderVehicle(car, {
              organizationName,
              routeName,
              routeNumber,
            }),
            organizationName,
          );
        }
      }
      return;
    }

    if (kind === "CONTRACT") {
      const routeName = text(
        pick(item, ["items.0.direction.name", "directions.0.name"]),
      );
      const routeNumber = text(
        pick(item, [
          "items.0.direction.pass_number",
          "directions.0.pass_number",
        ]),
      );
      const list = pick(item, ["cars"]);
      if (!Array.isArray(list)) return;
      for (const car of list) {
        this.addVehicle(
          vehicles,
          mapEtenderVehicle(car, { organizationName, routeName, routeNumber }),
          organizationName,
        );
      }
      return;
    }

    if (kind === "CERTIFICATE") {
      const car = pick(item, ["car"]);
      if (!isPlainObject(car)) return;
      this.addVehicle(
        vehicles,
        mapEtenderVehicle(car, {
          organizationName:
            text(pick(item, ["company_name"])) ?? organizationName,
          routeName: text(pick(item, ["direction.name"])),
          routeNumber: text(pick(item, ["direction.pass_number"])),
        }),
        organizationName,
      );
    }
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
