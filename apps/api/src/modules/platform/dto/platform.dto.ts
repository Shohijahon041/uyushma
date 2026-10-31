import { Transform } from "class-transformer";
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import { UserRole } from "@prisma/client";
import { toUzPhone, UZ_PHONE, UZ_PHONE_MESSAGE } from "../../../common/auth/phone";

const normalizeSlug = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim().toLowerCase() || undefined : value;
const trim = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

const DECIMAL_2 = /^\d{1,16}(\.\d{1,2})?$/;

export class SetCompanyStatusDto {
  @IsIn(["ACTIVE", "SUSPENDED"])
  status!: "ACTIVE" | "SUSPENDED";
}

class PasswordFields {
  /** Bo'sh qoldirilsa tizim xavfsiz vaqtinchalik parol yaratadi. */
  @IsOptional()
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  @Matches(/[A-Za-z]/, { message: "Parolda kamida bitta harf bo'lishi kerak" })
  @Matches(/[0-9]/, { message: "Parolda kamida bitta raqam bo'lishi kerak" })
  password?: string;
}

export class PlatformCreateCompanyDto extends PasswordFields {
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  companyName!: string;

  /** Bo'sh qoldirilsa nomdan avtomatik yaratiladi. */
  @IsOptional()
  @Transform(normalizeSlug)
  @IsString()
  @MinLength(3)
  @MaxLength(64)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: "Kompaniya kodi faqat kichik lotin harflari, raqam va defisdan iborat bo'lsin",
  })
  companySlug?: string;

  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  ownerFullName!: string;

  @Transform(toUzPhone)
  @IsString()
  @Matches(UZ_PHONE, { message: UZ_PHONE_MESSAGE })
  ownerPhone!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  planId?: string;
}

export class PlatformCreateUserDto extends PasswordFields {
  @Transform(toUzPhone)
  @IsString()
  @Matches(UZ_PHONE, { message: UZ_PHONE_MESSAGE })
  phone!: string;

  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  fullName!: string;

  @IsEnum(UserRole)
  role!: UserRole;
}

export class PlatformUpdateUserDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  fullName?: string;

  @IsOptional()
  @Transform(toUzPhone)
  @IsString()
  @Matches(UZ_PHONE, { message: UZ_PHONE_MESSAGE })
  phone?: string;

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  isSuperAdmin?: boolean;
}

export class PlatformUpdateCompanyDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @Transform(normalizeSlug)
  @IsString()
  @MinLength(3)
  @MaxLength(64)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: "Kompaniya kodi faqat kichik lotin harflari, raqam va defisdan iborat bo'lsin",
  })
  slug?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(32)
  paymentCardNumber?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  paymentCardHolder?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  paymentCardBank?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  paymentInstructions?: string;
}

export class PlatformSetSubscriptionDto {
  @IsOptional()
  @IsIn(["TRIAL", "ACTIVE", "PAST_DUE", "CANCELLED"])
  status?: "TRIAL" | "ACTIVE" | "PAST_DUE" | "CANCELLED";

  @IsOptional()
  @IsString()
  @MaxLength(40)
  planId?: string;

  @IsOptional()
  @IsDateString()
  currentPeriodEnd?: string;

  @IsOptional()
  @Matches(DECIMAL_2, { message: "Summa noto'g'ri formatda" })
  monthlyFee?: string;
}

export class PlatformResetPasswordDto extends PasswordFields {
  /** Telefon yo'qolgan bo'lsa 2FA ni ham o'chiradi. */
  @IsOptional()
  @IsBoolean()
  disableTwoFactor?: boolean;
}

export class CreateLicenseContractDto {
  @IsString()
  @MaxLength(40)
  planId!: string;

  @IsString()
  @Matches(DECIMAL_2, { message: "Summa noto'g'ri formatda" })
  amount!: string;

  @IsDateString()
  signedAt!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(40)
  number?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class RecordSubscriptionPaymentDto {
  @IsInt()
  @Min(1)
  @Max(12)
  months!: number;

  @IsOptional()
  @IsDateString()
  paidAt?: string;

  @IsOptional()
  @IsIn(["CASH", "BANK_TRANSFER", "CARD", "OTHER"])
  paymentMethod?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  note?: string;
}
