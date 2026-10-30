import type { ExternalProvider } from "@prisma/client";
import {
  type ExternalConnector,
  type ExternalFetchResult,
  type LoginResult,
  type NormalizedVehicle,
  type ProviderConfig,
  type ProviderCredentials,
} from "../external.types";
import {
  ExternalHttpError,
  externalRequestJson,
  isExternalAuthError,
} from "./http";
import { extractArray, mapBmVehicle, pick, text } from "./mapping";

const DEFAULT_PREFIX = "/non-brutto-management/api/v1";
const DEFAULT_PROFILE = "/user-management/api/v1/user-profile/account-authorities";

function joinUrl(baseUrl: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function accountName(profile: unknown): string | null {
  return text(
    pick(profile, [
      "data.orgName",
      "data.data.orgName",
      "orgName",
      "data.organizationName",
      "organizationName",
      "data.fullName",
      "data.data.fullName",
      "fullName",
      "data.username",
      "username",
    ]),
  );
}

/**
 * bm.dtransport.uz (Bus management) REST API. The SPA calls
 * GET {prefix}/vehicles for the non-brutto autopark list; brutto uses
 * POST /brutto-management/api/v1/vehicles. Both can be switched per tenant.
 */
export class AutoparkConnector implements ExternalConnector {
  readonly provider: ExternalProvider = "AUTOPARK";
  readonly defaultBaseUrl = "https://bmapi.dtransport.uz";

  /**
   * Bus management username/password login (the /log-in page). Returns a JWT
   * pair; the access token is what the registry endpoints expect.
   */
  async login(
    baseUrl: string,
    credentials: ProviderCredentials,
    config: ProviderConfig,
  ): Promise<LoginResult> {
    const path =
      config.endpoints?.login ?? "/user-management/api/v1/user-profile/login";
    let payload: unknown;
    try {
      payload = await externalRequestJson(joinUrl(baseUrl, path), {
        method: "POST",
        body: {
          username: credentials.username,
          password: credentials.password,
        },
      });
    } catch (error) {
      if (isExternalAuthError(error)) {
        throw new ExternalHttpError(
          401,
          "Kirish rad etildi: BM login yoki parol xato",
        );
      }
      throw error;
    }
    const token = text(
      pick(payload, [
        "access_token",
        "data.access_token",
        "data.data.access_token",
        "token.access_token",
        "data.token.access_token",
        "token",
      ]),
    );
    if (!token) {
      throw new ExternalHttpError(
        401,
        text(pick(payload, ["message", "data.message"])) ??
          "Kirish rad etildi: BM login yoki parol xato",
      );
    }
    let account: string | null = null;
    try {
      account = (await this.test(baseUrl, token)).account;
    } catch {
      // The token is valid even if the profile request is unavailable.
    }
    return { token, account };
  }

  async test(
    baseUrl: string,
    token: string,
  ): Promise<{ account: string | null }> {
    const payload = await externalRequestJson(joinUrl(baseUrl, DEFAULT_PROFILE), {
      token,
    });
    return { account: accountName(payload) };
  }

  async fetchAll(
    baseUrl: string,
    token: string,
    config: ProviderConfig,
  ): Promise<ExternalFetchResult> {
    const prefix = (config.registryPrefix ?? DEFAULT_PREFIX).replace(/\/+$/, "");
    const path = config.endpoints?.vehicles ?? `${prefix}/vehicles`;
    const pageSize = config.pageSize ?? 100;
    const vehicles = new Map<string, NormalizedVehicle>();
    const warnings: string[] = [];
    let account: string | null = null;

    try {
      const profile = await externalRequestJson(joinUrl(baseUrl, DEFAULT_PROFILE), {
        token,
      });
      account = accountName(profile);
    } catch (error) {
      if (isExternalAuthError(error)) throw error;
      // Profile is optional; the vehicle list still works with a valid token.
    }

    // BM pages are 0-based; a page that adds nothing new also ends the loop.
    for (let page = 0; page < 50; page += 1) {
      const url = `${joinUrl(baseUrl, path)}?page=${page}&size=${pageSize}`;
      let payload: unknown;
      try {
        payload = await externalRequestJson(url, { token });
      } catch (error) {
        if (isExternalAuthError(error)) throw error;
        warnings.push(
          `Avtopark ${page + 1}-sahifa: ${error instanceof Error ? error.message : String(error)}`,
        );
        break;
      }
      const items = extractArray(payload);
      if (items.length === 0) break;
      const before = vehicles.size;
      for (const item of items) {
        const vehicle = mapBmVehicle(item);
        if (!vehicle) continue;
        if (!vehicle.organizationName) vehicle.organizationName = account;
        vehicles.set(vehicle.externalId, vehicle);
      }
      if (items.length < pageSize || vehicles.size === before) break;
    }

    return { vehicles: [...vehicles.values()], records: [], warnings };
  }
}
