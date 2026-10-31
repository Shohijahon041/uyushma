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
import { ExternalHttpError, externalRequestJson, isExternalAuthError } from "./http";
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
  carRentingList: "/car/renting/list?myRentType=1&statusGroup=1",
  carRentingApi: "/api/car/renting/list",
  contractView: "/car/contract-view",
} as const;

function joinUrl(baseUrl: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

      return { token, account: account ?? credentials.username };
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
  async test(baseUrl: string, token: string): Promise<{ account: string | null }> {
    try {
      const payload = await externalRequestJson(joinUrl(baseUrl, "/api/user/profile"), {
        token,
      });
      const account = text(
        pick(payload, [
          "name",
          "full_name",
          "company_name",
          "organization_name",
          "data.name",
          "data.company_name",
          "tin",
          "pinfl",
        ]),
      );
      return { account };
    } catch (error) {
      // Fallback: car renting list orqali tekshirish
      if (isExternalAuthError(error)) throw error;
      try {
        await externalRequestJson(
          joinUrl(baseUrl, "/car/renting/list?myRentType=1&statusGroup=1&page=1&limit=1"),
          { token },
        );
        return { account: "Soliq Ijara Foydalanuvchisi" };
      } catch (inner) {
        if (isExternalAuthError(inner)) throw inner;
        return { account: null };
      }
    }
  }

  /**
   * Barcha avtomobil ijara shartnomalarini yuklab olish
   * https://ijara.soliq.uz/car/renting/list?myRentType=1&statusGroup=1
   */
  async fetchAll(
    baseUrl: string,
    token: string,
    config: ProviderConfig,
  ): Promise<ExternalFetchResult> {
    const warnings: string[] = [];
    const vehicles = new Map<string, NormalizedVehicle>();
    const records: NormalizedRecord[] = [];

    // Profil nomini olish
    let organizationName: string | null = null;
    try {
      const profile = await this.test(baseUrl, token);
      organizationName = profile.account;
    } catch (err) {
      if (isExternalAuthError(err)) throw err;
      warnings.push(`Profil: ${errorText(err)}`);
    }

    const endpoints = this.endpoints(config);
    const targetPath =
      endpoints.carRentingApi ?? endpoints.carRentingList ?? DEFAULT_ENDPOINTS.carRentingList;

    let page = 1;
    let maxPages = 50;

    while (page <= maxPages) {
      const urlWithPage = `${joinUrl(baseUrl, targetPath)}${targetPath.includes("?") ? "&" : "?"}page=${page}&limit=50&size=50`;
      try {
        const payload = await externalRequestJson(urlWithPage, {
          token,
        });

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

          const rec = mapIjaraRecord(raw);
          if (rec) {
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
        warnings.push(`Ijara shartnomalari sahifa ${page}: ${errorText(err)}`);
        break;
      }
    }

    return {
      vehicles: Array.from(vehicles.values()),
      records,
      warnings,
    };
  }
}
