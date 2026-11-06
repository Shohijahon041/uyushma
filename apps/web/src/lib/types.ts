export interface AuthUser {
  id: string;
  fullName: string;
  phone: string | null;
  role: "OWNER" | "ADMIN" | "ACCOUNTANT" | "MANAGER";
  isSuperAdmin: boolean;
  twoFactorEnabled: boolean;
  createdAt: string;
  company: { id: string; name: string; slug: string; status: string; isPlatform: boolean };
}

export interface DeviceSession {
  id: string;
  deviceLabel: string | null;
  userAgent: string | null;
  ip: string | null;
  lastUsedAt: string;
  createdAt: string;
  expiresAt: string;
  current: boolean;
}

export interface PaymeConfig {
  configured: boolean;
  provider?: "PAYME";
  merchantId?: string;
  login?: string;
  isActive?: boolean;
  webhookPath?: string;
  updatedAt?: string;
}

export interface DashboardSummary {
  counts: { vehicles: number; activeContracts: number; routes: number; users: number };
  drivers: { assignedToday: number; workedToday: number; paidForTomorrow: number };
  external: {
    vehicles: number;
    records: {
      CONTRACT_APPLICATION: number;
      CONTRACT: number;
      CERTIFICATE: number;
      TENDER_APPLICATION: number;
    };
    expiringCertificates: number;
    lastSyncAt: string | null;
    provider: ExternalProviderKey | null;
  };
  payments: {
    pendingAmount: string;
    pendingCount: number;
    paidThisMonth: string;
    recent: Array<{
      id: string;
      amount: string;
      status: string;
      method: string;
      createdAt: string;
      vehicle: string;
      owner: string;
    }>;
  };
  subscription: {
    status: string;
    planId: string;
    planName: string;
    currentPeriodEnd: string | null;
    monthlyFee?: string;
    hasContract?: boolean;
    openInvoices: number;
  } | null;
}

export interface Vehicle {
  id: string;
  plateNumber: string;
  model: string;
  capacity: number;
  monthlyFee: string;
  status: "ACTIVE" | "MAINTENANCE" | "INACTIVE";
  routeId: string | null;
  route: { id: string; name: string; monthlyPlan: string } | null;
  owner: { id: string; fullName: string };
  contracts: Array<{ id: string; type: string; startDate: string }>;
  assignments: Array<{
    id: string;
    startDate: string;
    driver: { id: string; fullName: string; phone: string };
  }>;
  externalVehicles: Array<{
    provider: ExternalProviderKey;
    garageNumber: string | null;
    routeName: string | null;
    routeNumber: string | null;
    licenseNumber: string | null;
    licenseExpiresAt: string | null;
  }>;
}

export interface RouteItem {
  id: string;
  name: string;
  origin: string;
  destination: string;
  distanceKm: string;
  monthlyPlan: string;
  isActive: boolean;
  _count: { tariffs: number; vehicles: number };
}

export interface TariffRule {
  id: string;
  code: string;
  label: string;
  operation: "OVERRIDE" | "ADD";
  amount: string;
  priority: number;
}

export interface Tariff {
  id: string;
  name: string;
  description: string | null;
  scope: "STANDARD" | "ROUTE" | "INDIVIDUAL";
  routeId: string | null;
  baseAmount: string;
  pricePerKm: string;
  currency: string;
  isActive: boolean;
  rules: TariffRule[];
  route: { id: string; name: string; distanceKm: string } | null;
}

export interface Contract {
  id: string;
  type: "SELF_USE" | "LEASE" | "SERVICE";
  status: "DRAFT" | "ACTIVE" | "TERMINATED";
  startDate: string;
  endDate: string | null;
  monthlyRate: string | null;
  notes: string | null;
  vehicle: { id: string; plateNumber: string; model: string };
  owner: { id: string; fullName: string };
  tariff: { id: string; name: string; scope: string } | null;
  _count?: { payments: number };
}

export interface Payment {
  id: string;
  amount: string;
  status: "PENDING" | "PAID" | "FAILED" | "CANCELLED";
  method: "MANUAL" | "AUTOMATIC";
  description: string | null;
  createdAt: string;
  paidAt: string | null;
  contract: {
    id: string;
    type: string;
    vehicle: { plateNumber: string; model: string };
    owner: { fullName: string };
  };
}

export interface UserItem {
  id: string;
  fullName: string;
  phone: string | null;
  role: "OWNER" | "ADMIN" | "ACCOUNTANT" | "MANAGER";
  isActive: boolean;
  twoFactorEnabled: boolean;
  lastLoginAt: string | null;
}

export interface Plan {
  id: string;
  name: string;
  monthlyPrice: string;
  currency: string;
  maxUsers: number;
  maxVehicles: number;
  features: Record<string, string[]>;
}

export interface SubscriptionInvoice {
  id: string;
  number: string;
  periodStart: string;
  periodEnd: string;
  amount: string;
  status: "OPEN" | "PAID" | "VOID" | "OVERDUE";
  dueDate: string;
  paidAt: string | null;
}

export interface Subscription {
  id: string;
  planId: string;
  status: "TRIAL" | "ACTIVE" | "PAST_DUE" | "CANCELLED";
  startDate: string;
  currentPeriodEnd: string | null;
  monthlyFee?: string | null;
  plan: Plan;
  invoices: SubscriptionInvoice[];
}

export interface AuditItem {
  id: string;
  actorUserId: string | null;
  actorType: string;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
}

export interface TelegramStatus {
  linked: boolean;
  username?: string | null;
  chatId?: string;
  linkedAt?: string;
}

export type ExternalProviderKey = "ETENDER" | "AUTOPARK" | "IJARA";

export interface ExternalConnection {
  id: string;
  provider: ExternalProviderKey;
  label: string;
  baseUrl: string;
  status: "ACTIVE" | "INVALID" | "DISABLED";
  account: string | null;
  authMode: "LOGIN" | "TOKEN";
  lastSyncAt: string | null;
  lastLoginAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExternalSyncRun {
  id: string;
  provider: ExternalProviderKey;
  status: "RUNNING" | "SUCCESS" | "FAILED";
  counts: Record<string, number> | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export type ExternalRecordKind =
  | "CONTRACT_APPLICATION"
  | "CONTRACT"
  | "CERTIFICATE"
  | "TENDER_APPLICATION"
  | "RENT_CONTRACT";

export interface ExternalVehicleRow {
  id: string;
  provider: ExternalProviderKey;
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
  licenseNumber: string | null;
  licenseExpiresAt: string | null;
  syncedAt: string;
  vehicle: { id: string; status: string } | null;
}

export interface ExternalRecordRow {
  id: string;
  provider: ExternalProviderKey;
  kind: ExternalRecordKind;
  externalId: string;
  number: string | null;
  title: string | null;
  status: string | null;
  startsAt: string | null;
  endsAt: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  syncedAt: string;
}

export interface CalculationResult {
  tariffName: string;
  baseAmount: string;
  pricePerKm: string;
  distanceKm: string;
  distanceCharge: string;
  subtotal: string;
  total: string;
  lines: Array<{
    code: string;
    label: string;
    operation: string;
    amount: string;
    before: string;
    after: string;
  }>;
}

export interface DriverItem {
  id: string;
  fullName: string;
  phone: string;
  licenseNumber: string | null;
  status: "ACTIVE" | "INACTIVE";
  notes: string | null;
  telegram: {
    linked: boolean;
    username: string | null;
    linkedAt: string | null;
    hasPhoto: boolean;
  };
  vehicle: {
    id: string;
    plateNumber: string;
    model: string;
    monthlyFee: string;
    assignedSince: string;
  } | null;
  month: {
    period: string;
    due: string;
    paid: string;
    debt: string;
    surplus: string;
  };
  totalDebt: string;
  workedToday: boolean;
  paidDays: number;
  coveredUntil: string | null;
}

export interface DriverPaymentRow {
  id: string;
  amount: string;
  method: "CASH" | "CARD";
  periodStart: string;
  paidAt: string;
  days: number;
  coveredFrom: string;
  coveredUntil: string;
  source: string;
  note: string | null;
  driver: { id: string; fullName: string; phone: string };
  vehicle: { id: string; plateNumber: string; model: string };
  receivedBy: { id: string; fullName: string } | null;
}

export interface DriverPassport {
  number: string | null;
  issuedBy: string | null;
  issuedAt: string | null;
  pinfl: string | null;
  birthDate: string | null;
  hasPhoto: boolean;
}

export interface DriverLicense {
  number: string | null;
  categories: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  hasPhoto: boolean;
}

export interface DriverProfile {
  driver: {
    id: string;
    fullName: string;
    phone: string;
    licenseNumber: string | null;
    status: "ACTIVE" | "INACTIVE";
    notes: string | null;
    telegram: {
      linked: boolean;
      username: string | null;
      linkedAt: string | null;
      firstName: string | null;
      lastName: string | null;
      hasPhoto: boolean;
    };
    passport: DriverPassport;
    license: DriverLicense;
    createdAt: string;
  };
  currentVehicle: {
    assignmentId: string;
    vehicleId: string;
    plateNumber: string;
    model: string;
    monthlyFee: string;
    routeName: string | null;
    assignedSince: string;
  } | null;
  currentMonth: {
    period: string;
    due: string;
    paid: string;
    debt: string;
    surplus: string;
  };
  totalDebt: string;
  months: Array<{
    month: string;
    due: string;
    paid: string;
    debt: string;
    surplus: string;
    planCount: number;
  }>;
  assignments: Array<{
    id: string;
    vehicle: { id: string; plateNumber: string; model: string; monthlyFee: string };
    startDate: string;
    endDate: string | null;
  }>;
  payments: DriverPaymentRow[];
}

export interface DailyBoardItem {
  vehicleId: string;
  plateNumber: string;
  model: string;
  vehicleStatus: string;
  monthlyFee: string;
  route: { id: string; name: string } | null;
  assignmentId: string;
  assignedSince: string;
  driver: { id: string; fullName: string; phone: string; status: string };
  planId: string | null;
  month: {
    period: string;
    due: string;
    paid: string;
    debt: string;
    surplus: string;
  };
  paidToday: string;
  totalDebt: string;
  worked: boolean;
  paidDays: number;
  coveredFrom: string | null;
  coveredUntil: string | null;
}

export interface DailyBoard {
  date: string;
  period: string;
  summary: {
    vehicles: number;
    withDriver: number;
    expected: string;
    paidMonth: string;
    debtMonth: string;
    collectedToday: string;
    paymentsToday: number;
    workedToday: number;
    totalDebt: string;
  };
  items: DailyBoardItem[];
  payments: DriverPaymentRow[];
  unassignedVehicles: number;
}

export interface PaymentTotals {
  count: number;
  amount: string;
  cash: string;
  card: string;
}

export interface PlatformOverview {
  companies: Array<{
    id: string;
    slug: string;
    name: string;
    status: "ACTIVE" | "SUSPENDED";
    createdAt: string;
    users: number;
    vehicles: number;
    drivers: number;
    payments: number;
    collected: string;
    planId: string | null;
    subscriptionStatus: string | null;
    periodEnd: string | null;
    monthlyFee: string | null;
    hasContract: boolean;
    unpaidCount: number;
    unpaidTotal: string;
    lastSyncAt: string | null;
  }>;
  totals: {
    companies: number;
    active: number;
    suspended: number;
    contracts: number;
    monthlyRevenue: string;
    unpaid: string;
    users: number;
    vehicles: number;
    drivers: number;
    payments: number;
    collected: string;
  };
}

export type UserRoleName = "OWNER" | "ADMIN" | "ACCOUNTANT" | "MANAGER";

export interface PlatformUser {
  id: string;
  companyId: string;
  companyName: string;
  companySlug: string;
  fullName: string;
  phone: string | null;
  role: UserRoleName;
  isActive: boolean;
  isSuperAdmin: boolean;
  twoFactorEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface LicenseContract {
  id: string;
  companyId: string;
  companyName: string;
  number: string;
  planId: string;
  amount: string;
  currency: string;
  signedAt: string;
  note: string | null;
  createdAt: string;
}

export type SubmissionStatus = "PENDING" | "APPROVED" | "REJECTED";
export type FraudRiskLevel = "LOW" | "MEDIUM" | "HIGH";

export interface PaymentSubmission {
  id: string;
  driverId: string;
  driver: {
    id: string;
    fullName: string;
    phone: string;
  };
  vehicleId: string | null;
  vehicle: {
    id: string;
    plateNumber: string;
    model: string;
  } | null;
  amount: string;
  receiptUrl: string;
  transactionNumber: string | null;
  senderPhone: string | null;
  paidAt: string | null;
  status: SubmissionStatus;
  fraudRisk: FraudRiskLevel;
  fraudScore: number;
  fraudFlags: string[];
  fraudAnalysis: Record<string, unknown> | null;
  reviewedAt: string | null;
  reviewerId: string | null;
  reviewer: {
    id: string;
    fullName: string;
  } | null;
  rejectionReason: string | null;
  driverPaymentId: string | null;
  driverPayment: {
    id: string;
    amount: string;
    paidAt: string;
  } | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CompanyPaymentDetails {
  paymentCardNumber: string | null;
  paymentCardHolder: string | null;
  paymentCardBank: string | null;
  paymentInstructions: string | null;
}

export interface CrossLinkedVehicleView {
  plateNumber: string;
  normalizedPlate: string;
  model: string | null;
  vin: string | null;
  nativeVehicleId: string | null;
  nativeVehicleStatus: string | null;
  nativeDriver?: {
    fullName: string;
    phone: string | null;
  } | null;
  nativeContract?: {
    id: string;
    type: string;
    status: string;
    startDate: string | null;
    endDate: string | null;
    monthlyRate: string | null;
  } | null;
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
  etender: {
    licenseNumber: string | null;
    licenseExpiresAt: string | null;
    isExpired: boolean;
    routeName: string | null;
    routeNumber: string | null;
    organizationName: string | null;
  } | null;
  autopark: {
    garageNumber: string | null;
    gpsImei: string | null;
    routeName: string | null;
    organizationName: string | null;
    vehicleModel?: string | null;
    vehicleClass?: string | null;
    drivers: Array<{ fullName: string; phone?: string | null }>;
  } | null;
  complianceStatus: "FULLY_COMPLIANT" | "PARTIAL" | "EXPIRED" | "NO_RENT_CONTRACT";
  complianceNotes: string[];
  daysToLicenseExpiry?: number | null;
  daysToRentExpiry?: number | null;
  urgencyLevel?: "EXPIRED" | "URGENT_15" | "WARNING_30" | "SAFE" | "NO_RENT";
}

export interface PublicVehiclePassport {
  plateNumber: string;
  model: string;
  vin: string | null;
  companyName: string;
  routeName: string | null;
  routeNumber: string | null;
  driverName: string | null;
  license: {
    number: string | null;
    expiresAt: string | null;
    isValid: boolean;
    daysLeft: number | null;
  };
  soliqLease: {
    contractNumber: string | null;
    endsAt: string | null;
    isValid: boolean;
    daysLeft: number | null;
  };
  shiftStatus: {
    isOnShift: boolean;
    startedAt: string | null;
  };
  complianceStatus: "FULLY_COMPLIANT" | "PARTIAL" | "EXPIRED" | "NO_RENT_CONTRACT";
  isVerified: boolean;
  verifiedAt: string;
}
