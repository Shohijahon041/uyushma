import { Transform, Type } from "class-transformer";
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import { DriverPaymentMethod, DriverStatus } from "@prisma/client";

const DECIMAL_2 = /^\d{1,16}(\.\d{1,2})?$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const normalizePhone = ({ value }: { value: unknown }) => {
  if (typeof value !== "string") return value;
  const digits = value.replace(/\D/g, "");
  if (digits.length === 9) return `+998${digits}`;
  if (digits.length === 12 && digits.startsWith("998")) return `+${digits}`;
  return value.replace(/[\s()-]/g, "");
};

const trim = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

export class CreateDriverDto {
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  fullName!: string;

  @Transform(normalizePhone)
  @IsString()
  @Matches(/^\+?\d{9,15}$/, { message: "Telefon raqami noto'g'ri formatda" })
  phone!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  licenseNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class UpdateDriverDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  fullName?: string;

  @IsOptional()
  @Transform(normalizePhone)
  @IsString()
  @Matches(/^\+?\d{9,15}$/, { message: "Telefon raqami noto'g'ri formatda" })
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  licenseNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsOptional()
  @IsEnum(DriverStatus)
  status?: DriverStatus;
}

export class AssignDriverDto {
  @IsUUID()
  vehicleId!: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_ONLY, { message: "Sana YYYY-MM-DD formatda bo'lishi kerak" })
  startDate?: string;

  /** Avtomobilning oylik plani. Berilsa, avtomobil normasi ham yangilanadi. */
  @IsOptional()
  @IsString()
  @Matches(DECIMAL_2, { message: "Oylik summa Decimal formatda bo'lishi kerak" })
  monthlyAmount?: string;
}

export class UnassignDriverDto {
  @IsOptional()
  @IsString()
  @Matches(DATE_ONLY, { message: "Sana YYYY-MM-DD formatda bo'lishi kerak" })
  endDate?: string;
}

export class CreateDriverPaymentDto {
  @IsUUID()
  vehicleId!: string;

  @IsOptional()
  @IsUUID()
  driverId?: string;

  @IsString()
  @Matches(DECIMAL_2, { message: "Summa Decimal formatda bo'lishi kerak" })
  amount!: string;

  @IsEnum(DriverPaymentMethod)
  method!: DriverPaymentMethod;

  @IsOptional()
  @IsString()
  paidAt?: string;

  /** To'lov nechta kunni qoplaydi (1–31). Standart — 1 kun. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(31)
  days?: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class UpdateMonthlyPlanDto {
  @IsString()
  @Matches(DECIMAL_2, { message: "Summa Decimal formatda bo'lishi kerak" })
  amount!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

/** Panel orqali hujjat maydonlarini tahrirlash. Bo'sh satr — tozalash. */
export class UpdateDriverDocumentsDto {
  @IsOptional() @IsString() @MaxLength(40) passportNumber?: string;
  @IsOptional() @IsString() @MaxLength(160) passportIssuedBy?: string;
  @IsOptional() @IsString() @MaxLength(20) passportIssuedAt?: string;
  @IsOptional() @IsString() @MaxLength(20) pinfl?: string;
  @IsOptional() @IsString() @MaxLength(20) birthDate?: string;
  @IsOptional() @IsString() @MaxLength(40) licenseNumber?: string;
  @IsOptional() @IsString() @MaxLength(60) licenseCategories?: string;
  @IsOptional() @IsString() @MaxLength(20) licenseIssuedAt?: string;
  @IsOptional() @IsString() @MaxLength(20) licenseExpiresAt?: string;
}
