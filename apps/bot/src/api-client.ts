export interface BotSummary {
  activeContracts: number;
  pendingCount: number;
  pendingAmount: string;
  paidLast30Days: string;
}

export interface BotContract {
  id: string;
  type: string;
  status: string;
  startDate: string;
  endDate: string | null;
  monthlyRate: string | null;
  vehicle: { plateNumber: string; model: string };
  tariffName: string | null;
}

export interface BotPayment {
  id: string;
  amount: string;
  status: string;
  method: string;
  createdAt: string;
  plateNumber: string;
}

export interface BotDriverMonth {
  period: string;
  due: string;
  paid: string;
  debt: string;
}

export interface BotDriverPayment {
  id: string;
  amount: string;
  method: "CASH" | "CARD";
  paidAt: string;
  days: number;
  plateNumber: string;
}

export interface BotPaymentCoverage {
  days: number;
  coveredFrom: string;
  coveredUntil: string;
}

export interface BotDriver {
  fullName: string;
  phone: string;
  companyName: string | null;
  vehicle: {
    plateNumber: string;
    model: string;
    monthlyFee: string;
    routeName?: string | null;
  } | null;
  month: BotDriverMonth;
  totalDebt: string;
  coverage: (BotPaymentCoverage & { workedToday: boolean }) | null;
  nextCoverage: BotPaymentCoverage | null;
  payments: BotDriverPayment[];
}

export interface BotWhoami {
  kind: "user" | "driver";
  fullName: string;
  companyName: string;
  vehicle?: BotDriver["vehicle"];
}

export interface BotDocuments {
  passport: {
    number: string | null;
    issuedBy: string | null;
    issuedAt: string | null;
    pinfl: string | null;
    birthDate: string | null;
    hasPhoto: boolean;
  };
  license: {
    number: string | null;
    categories: string | null;
    issuedAt: string | null;
    expiresAt: string | null;
    hasPhoto: boolean;
  };
}

export interface BotPublicPassport {
  plateNumber: string;
  plateDisplay?: string;
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
  shiftStatus: { isOnShift: boolean; startedAt: string | null };
  complianceStatus: "FULLY_COMPLIANT" | "PARTIAL" | "EXPIRED" | "NO_RENT_CONTRACT";
  isVerified: boolean;
  verificationNotes?: string[];
  verifiedAt: string;
}

export type DocumentField =
  | "passportNumber"
  | "passportIssuedBy"
  | "passportIssuedAt"
  | "pinfl"
  | "birthDate"
  | "passportPhotoFileId"
  | "licenseNumber"
  | "licenseCategories"
  | "licenseIssuedAt"
  | "licenseExpiresAt"
  | "licensePhotoFileId";

export interface TelegramProfile {
  chatId: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  photoFileId?: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class BotApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly botApiKey: string,
  ) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}/api/v1/integrations/telegram${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "X-Bot-Api-Key": this.botApiKey,
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(60_000),
    });
    const text = await response.text();
    if (!response.ok) {
      let message = `API xatosi (${response.status})`;
      try {
        const parsed = JSON.parse(text) as { message?: string | string[] };
        if (parsed.message) {
          message = Array.isArray(parsed.message)
            ? parsed.message.join(", ")
            : parsed.message;
        }
      } catch {
        // keep generic message
      }
      throw new ApiError(response.status, message);
    }
    return (text ? JSON.parse(text) : null) as T;
  }

  link(token: string, chatId: string, username?: string) {
    return this.request<{
      linked: boolean;
      kind: "user" | "driver";
      fullName: string;
      companyName: string;
    }>("/link", {
      method: "POST",
      body: JSON.stringify({ token, chatId, username }),
    });
  }

  linkPhone(input: TelegramProfile & { phone: string }) {
    return this.request<{
      linked: boolean;
      kind: "driver";
      fullName: string;
      companyName: string;
    }>("/link-phone", { method: "POST", body: JSON.stringify(input) });
  }

  syncProfile(input: TelegramProfile) {
    return this.request<{ ok: boolean }>("/driver/telegram-profile", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  documents(chatId: string) {
    return this.request<BotDocuments>(
      `/driver/documents?chatId=${encodeURIComponent(chatId)}`,
    );
  }

  driverPhoto(chatId: string, kind: "passport" | "license") {
    return this.request<{ fileId: string }>(
      `/driver/photo?chatId=${encodeURIComponent(chatId)}&kind=${kind}`,
    );
  }

  updateDocument(chatId: string, field: DocumentField, value: string) {
    return this.request<BotDocuments>("/driver/documents", {
      method: "POST",
      body: JSON.stringify({ chatId, field, value }),
    });
  }

  whoami(chatId: string) {
    return this.request<BotWhoami>(
      `/whoami?chatId=${encodeURIComponent(chatId)}`,
    );
  }

  driver(chatId: string) {
    return this.request<BotDriver>(
      `/driver?chatId=${encodeURIComponent(chatId)}`,
    );
  }

  profile(chatId: string) {
    return this.request<{
      fullName: string;
      role: string;
      companyName: string;
      companySlug: string;
    }>(`/profile?chatId=${encodeURIComponent(chatId)}`);
  }

  summary(chatId: string) {
    return this.request<BotSummary>(`/summary?chatId=${encodeURIComponent(chatId)}`);
  }

  contracts(chatId: string) {
    return this.request<{ items: BotContract[] }>(
      `/contracts?chatId=${encodeURIComponent(chatId)}`,
    );
  }

  payments(chatId: string) {
    return this.request<{ items: BotPayment[] }>(
      `/payments?chatId=${encodeURIComponent(chatId)}`,
    );
  }

  balance(chatId: string) {
    return this.request<{ pendingAmount: string; pendingCount: number }>(
      `/balance?chatId=${encodeURIComponent(chatId)}`,
    );
  }

  paymentCard(chatId: string) {
    return this.request<{
      id: string;
      name: string;
      paymentCardNumber: string | null;
      paymentCardHolder: string | null;
      paymentCardBank: string | null;
      paymentInstructions: string | null;
    }>(`/driver/payment-card?chatId=${encodeURIComponent(chatId)}`);
  }

  submitReceipt(
    chatId: string,
    amount: string,
    base64Data: string,
    filename: string,
    note?: string,
  ) {
    return this.request<{
      id: string;
      amount: string;
      status: string;
      fraudRisk: string;
      recommendation: string;
    }>("/driver/submit-receipt", {
      method: "POST",
      body: JSON.stringify({ chatId, amount, base64Data, filename, note }),
    });
  }

  startShift(chatId: string, startOdometer?: number, note?: string) {
    return this.request<{
      alreadyActive: boolean;
      shift: any;
      message: string;
    }>("/driver/shift/start", {
      method: "POST",
      body: JSON.stringify({ chatId, startOdometer, note }),
    });
  }

  endShift(chatId: string, endOdometer?: number, note?: string) {
    return this.request<{
      shift: any;
      durationMinutes: number;
      distanceKm: number | null;
      message: string;
    }>("/driver/shift/end", {
      method: "POST",
      body: JSON.stringify({ chatId, endOdometer, note }),
    });
  }

  currentShift(chatId: string) {
    return this.request<any | null>(
      `/driver/shift/current?chatId=${encodeURIComponent(chatId)}`,
    );
  }

  reportIncident(chatId: string, kind: string, description?: string) {
    return this.request<any>("/driver/incident", {
      method: "POST",
      body: JSON.stringify({ chatId, kind, description }),
    });
  }

  /** Davlat raqami bo'yicha ommaviy (public) yo'l pasporti. */
  async publicPassport(plate: string): Promise<BotPublicPassport | null> {
    const url = `${this.baseUrl}/api/v1/registry/public-verify/${encodeURIComponent(plate)}`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new ApiError(response.status, `Reyestr xatosi (${response.status})`);
    }
    return (await response.json()) as BotPublicPassport;
  }

  /** Pasport QR kodini PNG sifatida oladi. */
  async publicPassportQr(plate: string): Promise<Buffer | null> {
    const url = `${this.baseUrl}/api/v1/registry/public-verify/${encodeURIComponent(plate)}/qr`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;
    return Buffer.from(await response.arrayBuffer());
  }

  /** Ijara shartnomasi va litsenziya ma'lumotnomasini PDF sifatida oladi. */
  async publicPassportPdf(plate: string): Promise<Buffer | null> {
    const url = `${this.baseUrl}/api/v1/registry/public-verify/${encodeURIComponent(plate)}/pdf`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) return null;
    return Buffer.from(await response.arrayBuffer());
  }
}
