import { Transform } from "class-transformer";
import { IsOptional, IsString, Matches, MaxLength, MinLength } from "class-validator";
import { toUzPhone, UZ_PHONE, UZ_PHONE_MESSAGE } from "../../../common/auth/phone";

export class LoginDto {
  @Transform(toUzPhone)
  @IsString()
  @Matches(UZ_PHONE, { message: UZ_PHONE_MESSAGE })
  phone!: string;

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
