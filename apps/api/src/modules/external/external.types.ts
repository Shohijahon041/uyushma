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
  /** Target organization when one login account has several provider profiles. */
  organizationName?: string;
  profileId?: string;
}

/** A company profile the provider offers after authentication (BM profile picker). */
export interface ExternalProfileOption {
  id: string;
  organizationName?: string | null;
  companyName?: string | null;
  fullName?: string | null;
  tin?: string | null;
}

export function extractOneIdCode(input?: string | null): string {
  if (!input) return "";
  const trimmed = input.trim();
  if (trimmed.includes("?")) {
    try {
      const url = new URL(trimmed.startsWith("http") ? trimmed : `https://example.com/${trimmed}`);
      const code = url.searchParams.get("one_code") ?? url.searchParams.get("code");
      if (code) return code.trim();
    } catch {
      // fallback to regex
    }
  }
  const match = trimmed.match(/[?&](?:one_code|code)=([^&#\s]+)/i);
  if (match && match[1]) {
    return decodeURIComponent(match[1]).trim();
  }
  return trimmed;
}

export function extractTokenFromAny(input?: string | null): string {
  if (!input) return "";
  const trimmed = input.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      const found =
        obj.token ??
        obj.access_token ??
        obj.accessToken ??
        (obj.data && typeof obj.data === "object" ? (obj.data as Record<string, unknown>).token ?? (obj.data as Record<string, unknown>).access_token : undefined);
      if (typeof found === "string") return found.trim();
    } catch {
      // ignore
    }
  }
  const match = trimmed.match(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/);
  if (match) return match[0];
  return trimmed.replace(/^Bearer\s+/i, "").replace(/^["'`]|["'`]$/g, "").trim();
}

/**
 * Same fields the provider websites send: e-tender wants the One ID INN,
 * bm.dtransport.uz wants its own username. Passwords are only held encrypted.
 */
export interface ProviderCredentials {
  username?: string;
  password?: string;
  code?: string;
  ip?: string;
  /** Browser-session refresh token, kept so sync can renew an expired access token. */
  refreshToken?: string;
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
  /**
   * Picks the configured organization when the account owns several profiles.
   * Used for token-only connections captured from a browser session.
   */
  selectAccount?(
    baseUrl: string,
    token: string,
    target: { organizationName?: string; profileId?: string },
    profiles: ExternalProfileOption[],
  ): Promise<LoginResult | null>;
  /** Exchanges a stored refresh token for a fresh access token. */
  refresh?(
    baseUrl: string,
    refreshToken: string,
  ): Promise<{ token: string; refreshToken?: string }>;
  test(baseUrl: string, token: string): Promise<{ account: string | null }>;
  fetchAll(
    baseUrl: string,
    token: string,
    config: ProviderConfig,
  ): Promise<ExternalFetchResult>;
}

export interface OneIdConnectAllDto {
  username?: string; // OneID login (INN or PINFL)
  password?: string;
  code?: string; // OneID authorization code or redirect URL
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
  // Tizimda biriktirilgan haydovchi ma'lumotlari
  nativeDriver?: {
    fullName: string;
    phone: string | null;
  } | null;
  // Ichki platforma ijara shartnomasi ma'lumotlari
  nativeContract?: {
    id: string;
    type: string;
    status: string;
    startDate: string | null;
    endDate: string | null;
    monthlyRate: string | null;
  } | null;
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
    vehicleModel?: string | null;
    vehicleClass?: string | null;
    drivers: Array<{ fullName: string; phone?: string | null }>;
  } | null;
  // Qonuniylik va to'liqlik darajasi
  complianceStatus: "FULLY_COMPLIANT" | "PARTIAL" | "EXPIRED" | "NO_RENT_CONTRACT";
  complianceNotes: string[];
  daysToLicenseExpiry?: number | null;
  daysToRentExpiry?: number | null;
  urgencyLevel?: "EXPIRED" | "URGENT_15" | "WARNING_30" | "SAFE" | "NO_RENT";
}

export interface PublicVehiclePassport {
  plateNumber: string;
  plateDisplay: string;
  model: string;
  vin: string | null;
  companyName: string;
  routeName: string | null;
  routeNumber: string | null;
  driverName: string | null;
  driverPhone?: string | null;
  driverSource?: "SOLIQ" | "PLATFORM" | null;
  license: {
    number: string | null;
    expiresAt: string | null;
    isValid: boolean;
    daysLeft: number | null;
  };
  soliqLease: {
    contractNumber: string | null;
    startsAt?: string | null;
    endsAt: string | null;
    isValid: boolean;
    daysLeft: number | null;
    lesseeName?: string | null;
    lesseePinfl?: string | null;
    lesseePhone?: string | null;
  };
  shiftStatus: {
    isOnShift: boolean;
    startedAt: string | null;
  };
  complianceStatus: "FULLY_COMPLIANT" | "PARTIAL" | "EXPIRED" | "NO_RENT_CONTRACT";
  isVerified: boolean;
  verificationNotes?: string[];
  verifiedAt: string;
}
