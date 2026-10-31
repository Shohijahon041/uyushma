import type { ExternalProvider, ExternalRecordKind } from "@prisma/client";

export const EXTERNAL_PROVIDERS: ExternalProvider[] = [
  "ETENDER",
  "AUTOPARK",
  "IJARA",
];

export const PROVIDER_LABELS: Record<ExternalProvider, string> = {
  ETENDER: "e-tender.uztrans.uz",
  AUTOPARK: "bm.dtransport.uz",
  IJARA: "ijara.soliq.uz",
};

export const DEFAULT_BASE_URLS: Record<ExternalProvider, string> = {
  ETENDER: "https://e-tenderapi.uztrans.uz",
  AUTOPARK: "https://bmapi.dtransport.uz",
  IJARA: "https://ijara.soliq.uz",
};

export const RECORD_KIND_LABELS: Record<ExternalRecordKind, string> = {
  CONTRACT_APPLICATION: "Shartnoma arizalari",
  CONTRACT: "Shartnomalar",
  CERTIFICATE: "Guvohnomalar",
  TENDER_APPLICATION: "Tender arizalari",
  RENT_CONTRACT: "Ijara shartnomalari (Soliq)",
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

export interface NormalizedDriver {
  externalId: string;
  fullName: string;
  phone: string | null;
  pinfl: string | null;
  licenseNumber: string | null;
  licenseCategories: string | null;
  licenseExpiresAt: Date | null;
  routeName: string | null;
}

export interface ExternalFetchResult {
  vehicles: NormalizedVehicle[];
  records: NormalizedRecord[];
  drivers?: NormalizedDriver[];
  /** Routes the provider lists for the company, including ones with no vehicles today. */
  routeNames?: string[];
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

export interface OneIdConnectAllDto {
  username: string; // OneID login (INN or PINFL)
  password: string;
  ip?: string;
}

export interface OneIdConnectAllResult {
  overallSuccess: boolean;
  providers: Record<
    ExternalProvider,
    {
      success: boolean;
      account?: string | null;
      error?: string;
    }
  >;
}

export interface EImzoChallengeResponse {
  challenge: string;
  origin: string;
  expiresAt: string;
}

export interface EImzoLoginDto {
  challenge: string;
  pkcs7_64: string;
  serialNumber?: string;
}

export interface CrossLinkedVehicleView {
  plateNumber: string;
  normalizedPlate: string;
  model: string | null;
  vin: string | null;
  nativeVehicleId: string | null;
  nativeVehicleStatus: string | null;
  // Soliq ijara shartnomasi ma'lumotlari
  ijara: {
    contractId: string;
    contractNumber: string;
    startsAt: string | null;
    endsAt: string | null;
    isExpired: boolean;
    status: string;
    contractViewUrl: string;
    monthlyFee: string | null;
    lessor: string | null;
    lessee: {
      fullName: string | null;
      pinfl: string | null;
      phone: string | null;
    } | null;
  } | null;
  // E-Tender litsenziya va tender ma'lumotlari
  etender: {
    licenseNumber: string | null;
    licenseExpiresAt: string | null;
    isExpired: boolean;
    routeName: string | null;
    routeNumber: string | null;
    organizationName: string | null;
  } | null;
  // Toshkent BM monitoring va garaj ma'lumotlari
  autopark: {
    garageNumber: string | null;
    gpsImei: string | null;
    routeName: string | null;
    organizationName: string | null;
    drivers: Array<{ fullName: string; phone?: string | null }>;
  } | null;
  // Qonuniylik va to'liqlik darajasi
  complianceStatus: "FULLY_COMPLIANT" | "PARTIAL" | "EXPIRED" | "NO_RENT_CONTRACT";
  complianceNotes: string[];
}
