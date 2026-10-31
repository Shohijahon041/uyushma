import type { ExternalProvider } from "@prisma/client";
import {
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
  extractArray,
  extractPagination,
  mapIjaraRecord,
  mapIjaraVehicle,
  normalizePlate,
  pick,
  text,
} from "./mapping";

const DEFAULT_ENDPOINTS = {
  profile: "/api/user/profile",
  account: "https://my.soliq.uz/api/auth/oauth/account",
  carRentingApi: "/api/transport-rent/client/transport-rent/contract/get-list/by-params",
  contractView: "/car/contract-view",
} as const;

function joinUrl(baseUrl: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function extractPersonIdFromToken(token: string): { tin?: string; pinfl?: string; name?: string } | null {
  try {
    const parts = token.split(".");
    const part = parts[1];
    if (parts.length >= 2 && part) {
      const payloadStr = Buffer.from(part, "base64url").toString("utf8");
      const payload = JSON.parse(payloadStr);
      return {
        tin: payload.tin ?? payload.inn ?? payload.taxId ?? payload.uid,
        pinfl: payload.pinfl ?? payload.sub,
        name: payload.name ?? payload.company_name ?? payload.companyName ?? payload.fullName,
      };
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * ijara.soliq.uz — Davlat Soliq Qo'mitasining avtomobil ijara shartnomalari
 * integratsiya konnektori.
 */
export class IjaraConnector implements ExternalConnector {
  readonly provider: ExternalProvider = "IJARA";
  readonly defaultBaseUrl = "https://ijara.soliq.uz";

  private endpoints(config: ProviderConfig): Record<string, string> {
    return { ...DEFAULT_ENDPOINTS, ...(config.endpoints ?? {}) };
  }

  /**
   * OneID login yoki Soliq autentifikatsiyasi orqali kirish
   */
  async login(
    baseUrl: string,
    credentials: ProviderCredentials,
    config: ProviderConfig,
  ): Promise<LoginResult> {
    const loginPath = config.endpoints?.login ?? "/api/auth/oneid";
    try {
      const payload = await externalRequestJson(joinUrl(baseUrl, loginPath), {
        method: "POST",
        body: {
          username: credentials.username,
          password: credentials.password,
          ip: credentials.ip ?? "",
        },
      });

      const token = text(
        pick(payload, [
          "token",
          "access_token",
          "data.token",
          "data.access_token",
          "result.token",
        ]),
      );

      if (!token) {
        throw new Error(
          text(pick(payload, ["message", "error", "data.message"])) ??
          "ijara.soliq.uz dan token olinmadi",
        );
      }

      const account = text(
        pick(payload, [
          "company_name",
          "organization_name",
          "data.company_name",
          "user.name",
        ]),
      );

      return { token, account: account ?? credentials.username ?? null };
    } catch (error) {
      if (error instanceof ExternalHttpError) {
        throw new Error(`Soliq Ijara login xatosi (${error.status}): ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Mavjud tokenni tekshirish
   */
  async test(baseUrl: string, token: string): Promise<{ account: string | null; personId?: string | null }> {
    const clean = cleanBearerToken(token);
    if (!clean) {
      throw new Error("Token bo'sh bo'lmasligi kerak");
    }
    if (clean.startsWith("eimzo_")) {
      return { account: "Soliq E-IMZO Autentifikatsiyasi" };
    }

    // 1. my.soliq.uz/api/auth/oauth/account or /api/user/profile
    for (const testPath of [DEFAULT_ENDPOINTS.account, joinUrl(baseUrl, DEFAULT_ENDPOINTS.profile)]) {
      try {
        const payload = await externalRequestJson(testPath, { token: clean });
        const account = text(
          pick(payload, [
            "data.name",
            "data.company_name",
            "data.short_name",
            "name",
            "full_name",
            "company_name",
            "organization_name",
          ]),
        );
        const personId = text(pick(payload, ["data.tin", "data.pinfl", "tin", "pinfl"]));
        if (account || personId) {
          return { account: account ?? (personId ? `STIR: ${personId}` : null), personId };
        }
      } catch (error) {
        if (isExternalAuthError(error)) throw error;
      }
    }

    // 2. JWT tokenidan personId va tashkilot nomini ajratib olish
    const decoded = extractPersonIdFromToken(clean);
    if (decoded?.name || decoded?.tin || decoded?.pinfl) {
      const personId = decoded.tin ?? decoded.pinfl ?? null;
      return {
        account: decoded.name ?? (personId ? `STIR/JSHSHIR: ${personId}` : null),
        personId,
      };
    }

    // 3. Fallback: car renting list orqali tekshirish
    try {
      await externalRequestJson(
        joinUrl(baseUrl, `${DEFAULT_ENDPOINTS.carRentingApi}?page=0&size=1&myRentType=1&statusGroup=1`),
        { token: clean },
      );
      return { account: "Soliq Ijara Foydalanuvchisi" };
    } catch (inner) {
      if (isExternalAuthError(inner)) throw inner;
      return { account: null };
    }
  }

  /**
   * Barcha avtomobil ijara shartnomalarini yuklab olish
   * https://ijara.soliq.uz/api/transport-rent/client/transport-rent/contract/get-list/by-params
   */
  async fetchAll(
    baseUrl: string,
    token: string,
    config: ProviderConfig,
  ): Promise<ExternalFetchResult> {
    const cleanToken = cleanBearerToken(token);
    const warnings: string[] = [];
    const vehicles = new Map<string, NormalizedVehicle>();
    const records: NormalizedRecord[] = [];
    const drivers = new Map<string, import("../external.types").NormalizedDriver>();

    // Profil va personId (STIR yoki JSHSHIR) ni aniqlash
    let organizationName: string | null = null;
    let personId: string | null = text(pick(config, ["personId", "tin", "pinfl", "stir"])) ?? null;

    try {
      const profile = await this.test(baseUrl, cleanToken);
      organizationName = profile.account;
      if (!personId && profile.personId) {
        personId = profile.personId;
      }
    } catch (err) {
      if (isExternalAuthError(err)) throw err;
      warnings.push(`Profil: ${errorText(err)}`);
    }

    const endpoints = this.endpoints(config);
    const targetPath = endpoints.carRentingApi ?? DEFAULT_ENDPOINTS.carRentingApi;

    // myRentType: 1 - ijaraga oluvchi, 2 - ijaraga beruvchi
    const customRentType = (config as Record<string, unknown>).myRentType;
    const rentTypes = customRentType ? [Number(customRentType)] : [1, 2];

    // statusGroup: 1 - faol, 2 - tugagan/boshqa
    const customStatus = (config as Record<string, unknown>).statusGroup;
    const statusGroups = customStatus ? [String(customStatus)] : ["1", "2"];

    for (const rentType of rentTypes) {
      for (const statusGroup of statusGroups) {
        let page = 0;
        let maxPages = 50;

        while (page <= maxPages) {
          const queryParams = new URLSearchParams({
            page: String(page),
            size: "50",
            limit: "50",
            myRentType: String(rentType),
            statusGroup,
          });

          if (personId) {
            queryParams.set("personId", personId);
          }

          const url = `${joinUrl(baseUrl, targetPath)}${targetPath.includes("?") ? "&" : "?"}${queryParams.toString()}`;

          try {
            const payload = await externalRequestJson(url, { token: cleanToken });
            const items = extractArray(payload);

            if (!items || items.length === 0) break;

            for (const raw of items) {
              const veh = mapIjaraVehicle(raw);
              if (veh && veh.plateNumber) {
                const plateKey = normalizePlate(veh.plateNumber);
                if (!vehicles.has(plateKey)) {
                  vehicles.set(plateKey, {
                    ...veh,
                    organizationName: veh.organizationName ?? organizationName,
                  });
                }
              }

              // Ijarachi haydovchini ajratib olish
              const lesseeName = text(
                pick(raw, [
                  "lessee_name",
                  "lesseeName",
                  "lessee.name",
                  "driver_name",
                  "driverName",
                  "client_name",
                ]),
              );
              const lesseePinfl = text(
                pick(raw, ["lessee_pinfl", "lesseePinfl", "lessee.pinfl", "pinfl"]),
              );
              const lesseePhone = text(
                pick(raw, ["lessee_phone", "lesseePhone", "lessee.phone", "phone"]),
              );
              const lesseeLicense = text(
                pick(raw, ["lessee_license", "lesseeLicense", "license_number"]),
              );

              if (lesseeName) {
                const driverKey = (lesseePinfl ?? lesseePhone ?? lesseeName).toLowerCase();
                if (!drivers.has(driverKey)) {
                  drivers.set(driverKey, {
                    externalId: driverKey,
                    fullName: lesseeName,
                    phone: lesseePhone,
                    pinfl: lesseePinfl,
                    licenseNumber: lesseeLicense,
                    licenseCategories: null,
                    licenseExpiresAt: null,
                    routeName: null,
                  });
                }
              }

              const rec = mapIjaraRecord(raw);
              if (rec && !records.some((r) => r.externalId === rec.externalId)) {
                records.push(rec);
              }
            }

            const pagination = extractPagination(payload);
            if (pagination.lastPage && pagination.lastPage > 0) {
              maxPages = Math.min(pagination.lastPage, 100);
            } else if (items.length < 20) {
              break;
            }

            page += 1;
          } catch (err) {
            if (isExternalAuthError(err)) throw err;
            warnings.push(
              `Ijara shartnomalari (tur=${rentType}, holat=${statusGroup}, sahifa=${page + 1}): ${errorText(err)}`,
            );
            break;
          }
        }
      }
    }

    return {
      vehicles: Array.from(vehicles.values()),
      records,
      drivers: Array.from(drivers.values()),
      warnings,
    };
  }
}
