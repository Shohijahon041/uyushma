import { Transform } from "class-transformer";
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";
import { UserRole } from "@prisma/client";
import { toUzPhone, UZ_PHONE, UZ_PHONE_MESSAGE } from "../../../common/auth/phone";

class PasswordField {
  /** Bo'sh qoldirilsa tizim xavfsiz vaqtinchalik parol yaratadi. */
  @IsOptional()
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  @Matches(/[A-Za-z]/, { message: "Parolda kamida bitta harf bo'lishi kerak" })
  @Matches(/[0-9]/, { message: "Parolda kamida bitta raqam bo'lishi kerak" })
  password?: string;
}

export class CreateUserDto extends PasswordField {
  @Transform(toUzPhone)
  @IsString()
  @Matches(UZ_PHONE, { message: UZ_PHONE_MESSAGE })
  phone!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(160)
  fullName!: string;

  @IsEnum(UserRole)
  role!: UserRole;
}

export class UpdateUserDto {
  @IsOptional()
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
}

export class ResetUserPasswordDto extends PasswordField {}
