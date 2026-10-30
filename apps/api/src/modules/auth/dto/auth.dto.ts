import { Transform } from "class-transformer";
import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim().toLowerCase() : value;

const normalizeSlug = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim().toLowerCase() : value;

export class RegisterCompanyDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  companyName!: string;

  @Transform(normalizeSlug)
  @IsString()
  @MinLength(3)
  @MaxLength(64)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: "Kompaniya kodi faqat kichik lotin harflari, raqam va defisdan iborat bo'lsin",
  })
  companySlug!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(160)
  fullName!: string;

  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(128)
  @Matches(/[A-Za-z]/, { message: "Parolda kamida bitta harf bo'lishi kerak" })
  @Matches(/[0-9]/, { message: "Parolda kamida bitta raqam bo'lishi kerak" })
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;
}

export class LoginDto {
  @Transform(normalizeSlug)
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  companySlug!: string;

  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}

export class RefreshDto {
  @IsString()
  @MinLength(20)
  @MaxLength(4096)
  refreshToken!: string;
}

export class VerifyTwoFactorDto {
  @IsString()
  @MinLength(20)
  @MaxLength(4096)
  mfaToken!: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, { message: "Kod 6 xonali raqam bo'lishi kerak" })
  code?: string;

  @IsOptional()
  @IsString()
  @MinLength(6)
  @MaxLength(32)
  recoveryCode?: string;
}

export class TwoFactorCodeDto {
  @IsString()
  @Matches(/^\d{6}$/, { message: "Kod 6 xonali raqam bo'lishi kerak" })
  code!: string;
}

export class DisableTwoFactorDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, { message: "Kod 6 xonali raqam bo'lishi kerak" })
  code?: string;

  @IsOptional()
  @IsString()
  @MinLength(6)
  @MaxLength(32)
  recoveryCode?: string;
}

export class ForgotPasswordDto {
  @Transform(normalizeSlug)
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  companySlug!: string;

  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(320)
  email!: string;
}

export class ResetPasswordDto {
  @Transform(normalizeSlug)
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  companySlug!: string;

  @IsString()
  @MinLength(20)
  @MaxLength(256)
  token!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(128)
  @Matches(/[A-Za-z]/, { message: "Parolda kamida bitta harf bo'lishi kerak" })
  @Matches(/[0-9]/, { message: "Parolda kamida bitta raqam bo'lishi kerak" })
  password!: string;
}

export class VerifyEmailDto {
  @Transform(normalizeSlug)
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  companySlug!: string;

  @IsString()
  @MinLength(20)
  @MaxLength(256)
  token!: string;
}
