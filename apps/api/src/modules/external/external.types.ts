import type { ExternalProvider, ExternalRecordKind } from "@prisma/client";

export const EXTERNAL_PROVIDERS: ExternalProvider[] = ["ETENDER", "AUTOPARK"];

export const PROVIDER_LABELS: Record<ExternalProvider, string> = {
  ETENDER: "e-tender.uztrans.uz",
  AUTOPARK: "bm.dtransport.uz",
};

export const DEFAULT_BASE_URLS: Record<ExternalProvider, string> = {
  ETENDER: "https://e-tenderapi.uztrans.uz",
  AUTOPARK: "https://bmapi.dtransport.uz",
};

export const RECORD_KIND_LABELS: Record<ExternalRecordKind, string> = {
  CONTRACT_APPLICATION: "Shartnoma arizalari",
  CONTRACT: "Shartnomalar",
  CERTIFICATE: "Guvohnomalar",
  TENDER_APPLICATION: "Tender arizalari",
};

export interface NormalizedVehicle {
  externalId: string;
  plateNumber: string | null;
  garageNumber: string | null;
  vin: string | null;
  gpsImei: string | null;
  organizationName: string | null;
  routeName: string | null;
  routeNumber: string | null;
  vehicleClass: string | null;
  vehicleModel: string | null;
  drivers: unknown;
  licenseNumber: string | null;
  licenseExpiresAt: Date | null;
  raw: unknown;
}

export interface NormalizedRecord {
  kind: ExternalRecordKind;
  externalId: string;
  number: string | null;
  title: string | null;
  status: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  issuedAt: Date | null;
  expiresAt: Date | null;
  raw: unknown;
}

export interface ExternalFetchResult {
  vehicles: NormalizedVehicle[];
  records: NormalizedRecord[];
  warnings: string[];
}

export interface ProviderConfig {
  endpoints?: Record<string, string>;
  pageSize?: number;
  registryPrefix?: string;
  reportBody?: unknown;
  /** Organization name reported by the provider; written by sync, display only. */
  account?: string;
}

/**
 * Same fields the provider websites send: e-tender wants the One ID INN,
 * bm.dtransport.uz wants its own username. Passwords are only held encrypted.
 */
export interface ProviderCredentials {
  username: string;
  password: string;
  ip?: string;
}

export interface LoginResult {
  token: string;
  account: string | null;
}

export interface ExternalConnector {
  readonly provider: ExternalProvider;
  readonly defaultBaseUrl: string;
  login?(
    baseUrl: string,
    credentials: ProviderCredentials,
    config: ProviderConfig,
  ): Promise<LoginResult>;
  test(baseUrl: string, token: string): Promise<{ account: string | null }>;
  fetchAll(
    baseUrl: string,
    token: string,
    config: ProviderConfig,
  ): Promise<ExternalFetchResult>;
}
