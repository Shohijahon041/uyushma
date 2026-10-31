import type { ExternalProvider } from "@prisma/client";
import {
  extractOneIdCode,
  type ExternalConnector,
  type ExternalFetchResult,
  type LoginResult,
  type NormalizedDriver,
  type NormalizedVehicle,
  type ProviderConfig,
  type ProviderCredentials,
} from "../external.types";
import {
  cleanBearerToken,
  ExternalHttpError,
  externalRequestJson,
  isExternalAuthError,
} from "./http";
import { extractArray, mapBmVehicle, pick, text, toDate } from "./mapping";

const DEFAULT_PREFIX = "/non-brutto-management/api/v1";
const DEFAULT_PROFILE = "/user-management/api/v1/user-profile/account-authorities";
const ROUTE_TREE = "/route-management/api/v1/route-variants/tree";
const BRUTTO = "/brutto-management/api/v1";
const NON_BRUTTO = "/non-brutto-management/api/v1";
const MAX_ROUTES = 80;
const MAX_DRIVER_DETAILS = 300;

type AnyRecord = Record<string, unknown>;

interface RouteLeaf {
  id: string;
  name: string;
  organizationName: string | null;
  brutto: boolean;
}

function isRecord(value: unknown): value is AnyRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The endpoint exists in only one of the brutto / non-brutto modules. */
function isMissingEndpoint(error: unknown): boolean {
  return (
    error instanceof ExternalHttpError &&
    [400, 404, 405].includes(error.status)
  );
}

/** BM answers 403 per endpoint for roles lacking that page, while the token stays valid. */
function isTokenRejected(error: unknown): boolean {
  return error instanceof ExternalHttpError && error.status === 401;
}

function isForbidden(error: unknown): boolean {
  return error instanceof ExternalHttpError && error.status === 403;
}

function tashkentToday(): string {
  return new Date(Date.now() + 5 * 3_600_000).toISOString().slice(0, 10);
}

/** BM tokens are Keycloak JWTs scoped to one organisation. */
function tokenOrganization(token: string): string | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const claims = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as AnyRecord;
    return typeof claims.organizationId === "string" ? claims.organizationId : null;
  } catch {
    return null;
  }
}

function treeNodes(payload: unknown): unknown[] {
  const data = isRecord(payload) && "data" in payload ? payload.data : payload;
  return Array.isArray(data) ? data : [];
}

function nodeId(node: AnyRecord): string | null {
  return text(node.id ?? node.routeVariantId ?? node.entityId);
}

function findNode(nodes: unknown[], id: string): AnyRecord | null {
  for (const node of nodes) {
    if (!isRecord(node)) continue;
    if (nodeId(node) === id) return node;
    const found = findNode(Array.isArray(node.children) ? node.children : [], id);
    if (found) return found;
  }
  return null;
}

/** region → organisation → park → ROUTE; only the token's organisation is kept. */
export function collectRouteLeaves(
  payload: unknown,
  brutto: boolean,
  organizationId: string | null,
): RouteLeaf[] {
  const roots = treeNodes(payload);
  const own = organizationId ? findNode(roots, organizationId) : null;
  const leaves: RouteLeaf[] = [];
  const walk = (nodes: unknown[], organizationName: string | null) => {
    for (const node of nodes) {
      if (!isRecord(node)) continue;
      const children = Array.isArray(node.children) ? node.children : [];
      const type = String(node.entityType ?? "").toUpperCase();
      const name = text(node.name);
      const org = type.includes("ORG") ? name : organizationName;
      if (children.length === 0 && type === "ROUTE") {
        const id = nodeId(node);
        if (id && name) leaves.push({ id, name, organizationName: org, brutto });
      }
      walk(children, org);
    }
  };
  walk(own ? [own] : roots, own ? text(own.name) : null);
  return leaves;
}

function formatPhone(value: unknown): string | null {
  const raw = text(value);
  if (!raw || raw.includes("*")) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 9) return `+998${digits}`;
  if (digits.length === 12 && digits.startsWith("998")) return `+${digits}`;
  if (digits.length >= 9 && digits.length <= 15) return `+${digits}`;
  return null;
}

function driverName(item: unknown): string | null {
  const full = text(pick(item, ["fullName", "driverName", "name"]));
  if (full) return full;
  const parts = ["lastName", "firstName", "middleName"]
    .map((key) => text(pick(item, [key])))
    .filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}

export function mapBmDriver(item: unknown, routeName: string | null = null): NormalizedDriver | null {
  const externalId = text(pick(item, ["id", "driverId"]));
  const fullName = driverName(item);
  if (!externalId || !fullName) return null;
  const pinfl = text(pick(item, ["pinfl", "pinfL", "jshshir"]));
  return {
    externalId,
    fullName: fullName.replace(/\s+/g, " ").trim().slice(0, 160),
    phone: formatPhone(pick(item, ["phoneNumber", "phone", "mobilePhone"])),
    pinfl: pinfl && /^\d{14}$/.test(pinfl) ? pinfl : null,
    licenseNumber: text(pick(item, ["licenseNumber", "driverLicenseNumber", "licenceNumber"])),
    licenseCategories: text(pick(item, ["category", "licenseCategory", "categories"])),
    licenseExpiresAt: toDate(pick(item, ["licenseExpiryDate", "licenseExpiresAt", "licenseExpireDate"])),
    routeName,
  };
}

async function mapLimit<T>(items: T[], limit: number, task: (item: T) => Promise<void>) {
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index++] as T;
      await task(item);
    }
  });
  await Promise.all(workers);
}

/**
 * bm.dtransport.uz (Bus management) REST API. The company's routes come from
 * the route-variant tree; vehicles and drivers are listed per route variant
 * under brutto- or non-brutto-management depending on the organisation.
 */
export class AutoparkConnector implements ExternalConnector {
  readonly provider: ExternalProvider = "AUTOPARK";
  readonly defaultBaseUrl = "https://bmapi.dtransport.uz";

  async login(
    baseUrl: string,
    credentials: ProviderCredentials,
    config: ProviderConfig,
  ): Promise<LoginResult> {
    // 1. OneID OAuth2 Authorization Code orqali kirish
    const rawCode =
      credentials.code ||
      (credentials.username &&
      (credentials.username.includes("code=") ||
        credentials.username.startsWith("http"))
        ? credentials.username
        : null);

    if (rawCode) {
      const code = extractOneIdCode(rawCode);
      if (code) {
        try {
          const profilesUrl = joinUrl(
            baseUrl,
            `/user-management/api/v1/user-profile/login-via-oneid/profiles?code=${encodeURIComponent(code)}`,
          );
          const oneIdPayload = (await externalRequestJson(profilesUrl, {
            method: "POST",
          })) as {
            data?: {
              token?: { access_token?: string; refresh_token?: string };
              profiles?: Array<{ id: string; organizationName?: string; companyName?: string }>;
            };
          };

          let token = cleanBearerToken(oneIdPayload?.data?.token?.access_token);
          let accountName: string | null = null;

          const profiles = oneIdPayload?.data?.profiles;
          if (profiles && profiles.length > 0) {
            const chosen = profiles[0];
            if (chosen?.id) {
              try {
                const tokenUrl = joinUrl(
                  baseUrl,
                  `/user-management/api/v1/user-profile/get-token-by-profile/${chosen.id}`,
                );
                const tokenRes = (await externalRequestJson(tokenUrl, {
                  method: "POST",
                })) as { data?: { access_token?: string; token?: string } };
                const subToken = cleanBearerToken(
                  tokenRes?.data?.access_token ?? tokenRes?.data?.token,
                );
                if (subToken) token = subToken;
              } catch {
                // Agar profil tanlash xato bersa, asosiy tokenni ishlatamiz
              }
              accountName = chosen.organizationName ?? chosen.companyName ?? null;
            }
          }

          if (token) {
            return { token, account: accountName };
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

    // 2. An'anaviy login va parol orqali kirish
    const path =
      config.endpoints?.login ?? "/user-management/api/v1/user-profile/login";
    let payload: unknown;
    try {
      payload = await externalRequestJson(joinUrl(baseUrl, path), {
        method: "POST",
        body: {
          username: (credentials.username ?? "").trim(),
          password: credentials.password ?? "",
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
    const rawToken = text(
      pick(payload, [
        "access_token",
        "data.access_token",
        "data.data.access_token",
        "token.access_token",
        "data.token.access_token",
        "result.access_token",
        "result.token",
        "token",
      ]),
    );
    const token = cleanBearerToken(rawToken);
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
    const warnings: string[] = [];
    const forbidden: string[] = [];
    let account: string | null = null;

    try {
      const profile = await externalRequestJson(joinUrl(baseUrl, DEFAULT_PROFILE), {
        token,
      });
      account = accountName(profile);
    } catch (error) {
      if (isTokenRejected(error)) throw error;
      if (isForbidden(error)) forbidden.push("profil");
    }

    const leaves = await this.routeLeaves(baseUrl, token, warnings, forbidden);
    const vehicles = new Map<string, NormalizedVehicle>();
    let driverModule: string | null = null;

    for (const module of [NON_BRUTTO, BRUTTO]) {
      const items = await this.vehicleList(baseUrl, token, module, warnings, forbidden);
      if (items.length > 0) driverModule ??= module;
      for (const item of items) {
        const vehicle = mapBmVehicle(item);
        if (!vehicle) continue;
        vehicle.organizationName ??= account;
        vehicles.set(vehicle.externalId, vehicle);
      }
    }

    if (vehicles.size > 0) {
      const drivers = await this.drivers(
        baseUrl,
        token,
        driverModule ?? NON_BRUTTO,
        new Map(),
        warnings,
      );
      return { vehicles: [...vehicles.values()], records: [], drivers, warnings };
    }

    if (leaves.length === 0) {
      const legacy = await this.legacyVehicles(baseUrl, token, config, account, warnings, forbidden);
      this.assertAccessible(legacy.length, forbidden);
      return { vehicles: legacy, records: [], drivers: [], warnings };
    }

    const today = tashkentToday();
    const routeDrivers = new Map<string, string>();

    for (const leaf of leaves) {
      const modules = leaf.brutto ? [BRUTTO, NON_BRUTTO] : [NON_BRUTTO, BRUTTO];
      const items = await this.firstAvailable(
        baseUrl,
        token,
        modules.map((module) => `${module}/vehicles/by-route-variant/${leaf.id}?dutyDate=${today}`),
        `"${leaf.name}" avtomobillari`,
        warnings,
        forbidden,
      );
      for (const item of items.list) {
        const vehicle = mapBmVehicle(item);
        if (!vehicle) continue;
        vehicle.routeName = leaf.name;
        vehicle.organizationName ??= leaf.organizationName ?? account;
        vehicles.set(vehicle.externalId, vehicle);
      }

      const drivers = await this.firstAvailable(
        baseUrl,
        token,
        modules.map(
          (module) =>
            `${module}/drivers/by-route-variant/${leaf.id}?dutyDate=${today}&page=0&size=200`,
        ),
        `"${leaf.name}" haydovchilari`,
        warnings,
        forbidden,
      );
      if (drivers.path) driverModule ??= drivers.path.split("/drivers/")[0]!;
      for (const item of drivers.list) {
        const id = text(pick(item, ["id", "driverId"]));
        if (id && !routeDrivers.has(id)) routeDrivers.set(id, leaf.name);
      }
      if (items.path) driverModule ??= items.path.split("/vehicles/")[0]!;
    }

    const drivers = await this.drivers(
      baseUrl,
      token,
      driverModule ?? (leaves[0]!.brutto ? BRUTTO : NON_BRUTTO),
      routeDrivers,
      warnings,
    );
    this.assertAccessible(vehicles.size + drivers.length, forbidden);

    return {
      vehicles: [...vehicles.values()],
      records: [],
      drivers,
      routeNames: leaves.map((leaf) => leaf.name),
      warnings,
    };
  }

  /** Only fail when the role could read nothing at all; partial access still syncs. */
  private assertAccessible(found: number, forbidden: string[]) {
    if (found > 0 || forbidden.length === 0) return;
    throw new ExternalHttpError(
      403,
      `BM foydalanuvchisiga avtopark ma'lumotlari yopiq (HTTP 403): ${[...new Set(forbidden)]
        .slice(0, 5)
        .join(", ")}. BM'da "Avtopark" bo'limini ko'ra oladigan foydalanuvchi bilan ulaning`,
    );
  }

  /** Organisation-wide paged list used by the BM web app (POST with filter body). */
  private async vehicleList(
    baseUrl: string,
    token: string,
    module: string,
    warnings: string[],
    forbidden: string[],
  ): Promise<unknown[]> {
    const items: unknown[] = [];
    const size = 200;
    for (let page = 0; page < 50; page += 1) {
      let payload: unknown;
      try {
        payload = await externalRequestJson(
          joinUrl(baseUrl, `${module}/vehicles?page=${page}&size=${size}`),
          { token, method: "POST", body: {}, timeoutMs: 30_000 },
        );
      } catch (error) {
        if (isTokenRejected(error)) throw error;
        if (isForbidden(error)) forbidden.push(`${module}/vehicles`);
        else if (!isMissingEndpoint(error) || page > 0) {
          warnings.push(`Avtopark ro'yxati ${page + 1}-sahifa: ${errorText(error)}`);
        }
        break;
      }
      const list = extractArray(payload);
      items.push(...list);
      const totalPages = Number(pick(payload, ["data.page.totalPages", "data.totalPages"]));
      if (list.length < size || (Number.isFinite(totalPages) && page + 1 >= totalPages)) break;
    }
    return items;
  }

  private async routeLeaves(
    baseUrl: string,
    token: string,
    warnings: string[],
    forbidden: string[],
  ): Promise<RouteLeaf[]> {
    const organizationId = tokenOrganization(token);
    const leaves = new Map<string, RouteLeaf>();
    for (const brutto of [false, true]) {
      let payload: unknown;
      try {
        payload = await externalRequestJson(
          joinUrl(baseUrl, `${ROUTE_TREE}?isBrutto=${brutto}`),
          { token, timeoutMs: 30_000 },
        );
      } catch (error) {
        if (isTokenRejected(error)) throw error;
        if (isForbidden(error)) {
          forbidden.push("yo'nalishlar daraxti");
          continue;
        }
        warnings.push(`Yo'nalishlar daraxti (${brutto ? "brutto" : "non-brutto"}): ${errorText(error)}`);
        continue;
      }
      for (const leaf of collectRouteLeaves(payload, brutto, organizationId)) {
        if (!leaves.has(leaf.id)) leaves.set(leaf.id, leaf);
      }
    }
    const list = [...leaves.values()];
    if (list.length > MAX_ROUTES) {
      warnings.push(
        `Yo'nalishlar soni ${list.length} ta — birinchi ${MAX_ROUTES} tasi sinxronlandi`,
      );
      return list.slice(0, MAX_ROUTES);
    }
    return list;
  }

  private async firstAvailable(
    baseUrl: string,
    token: string,
    paths: string[],
    label: string,
    warnings: string[],
    forbidden: string[],
  ): Promise<{ list: unknown[]; path: string | null }> {
    let lastError: unknown = null;
    for (const path of paths) {
      try {
        const payload = await externalRequestJson(joinUrl(baseUrl, path), {
          token,
          timeoutMs: 30_000,
        });
        return { list: extractArray(payload), path };
      } catch (error) {
        if (isTokenRejected(error)) throw error;
        lastError = error;
        if (!isMissingEndpoint(error) && !isForbidden(error)) break;
      }
    }
    if (isForbidden(lastError)) forbidden.push(label);
    else if (lastError) warnings.push(`${label}: ${errorText(lastError)}`);
    return { list: [], path: null };
  }

  /** The list masks phone/PINFL; the detail endpoint returns them in full. */
  private async drivers(
    baseUrl: string,
    token: string,
    module: string,
    routeDrivers: Map<string, string>,
    warnings: string[],
  ): Promise<NormalizedDriver[]> {
    const summaries = new Map<string, unknown>();
    for (let page = 0; page < 20; page += 1) {
      let payload: unknown;
      try {
        payload = await externalRequestJson(
          joinUrl(baseUrl, `${module}/drivers?page=${page}&size=200`),
          { token, timeoutMs: 30_000 },
        );
      } catch (error) {
        if (isTokenRejected(error)) throw error;
        if (page === 0 && routeDrivers.size === 0 && !isForbidden(error)) {
          warnings.push(`Haydovchilar ro'yxati: ${errorText(error)}`);
        }
        break;
      }
      const items = extractArray(payload);
      const before = summaries.size;
      for (const item of items) {
        const id = text(pick(item, ["id", "driverId"]));
        if (id) summaries.set(id, item);
      }
      if (items.length < 200 || summaries.size === before) break;
    }
    for (const id of routeDrivers.keys()) {
      if (!summaries.has(id)) summaries.set(id, { id });
    }

    const ids = [...summaries.keys()];
    if (ids.length > MAX_DRIVER_DETAILS) {
      warnings.push(
        `Haydovchilar ${ids.length} ta — ${MAX_DRIVER_DETAILS} tasining to'liq ma'lumoti olindi`,
      );
    }
    const result = new Map<string, NormalizedDriver>();
    let failed = 0;
    await mapLimit(ids.slice(0, MAX_DRIVER_DETAILS), 4, async (id) => {
      let detail: unknown = null;
      try {
        const payload = await externalRequestJson(
          joinUrl(baseUrl, `${module}/drivers/${encodeURIComponent(id)}`),
          { token, timeoutMs: 20_000 },
        );
        detail = isRecord(payload) && isRecord(payload.data) ? payload.data : payload;
      } catch (error) {
        if (isTokenRejected(error)) throw error;
        failed += 1;
      }
      const merged = {
        ...(isRecord(summaries.get(id)) ? (summaries.get(id) as AnyRecord) : {}),
        ...(isRecord(detail) ? detail : {}),
      };
      const driver = mapBmDriver(merged, routeDrivers.get(id) ?? null);
      if (driver) result.set(driver.externalId, driver);
    });
    if (failed > 0) warnings.push(`${failed} ta haydovchi tafsiloti olinmadi`);
    return [...result.values()];
  }

  /** Older deployments exposed a flat paged list; kept as a fallback. */
  private async legacyVehicles(
    baseUrl: string,
    token: string,
    config: ProviderConfig,
    account: string | null,
    warnings: string[],
    forbidden: string[],
  ): Promise<NormalizedVehicle[]> {
    const prefix = (config.registryPrefix ?? DEFAULT_PREFIX).replace(/\/+$/, "");
    const path = config.endpoints?.vehicles ?? `${prefix}/vehicles`;
    const pageSize = config.pageSize ?? 100;
    const vehicles = new Map<string, NormalizedVehicle>();
    for (let page = 0; page < 50; page += 1) {
      const url = `${joinUrl(baseUrl, path)}?page=${page}&size=${pageSize}`;
      let payload: unknown;
      try {
        payload = await externalRequestJson(url, { token });
      } catch (error) {
        if (isTokenRejected(error)) throw error;
        if (isForbidden(error)) forbidden.push("avtopark ro'yxati");
        else warnings.push(`Avtopark ${page + 1}-sahifa: ${errorText(error)}`);
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
    return [...vehicles.values()];
  }
}
