import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
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
  ValidateNested,
} from "class-validator";
import { TariffRuleOperation, TariffScope } from "@prisma/client";

const DECIMAL_2 = /^\d{1,16}(\.\d{1,2})?$/;

export class TariffRuleDto {
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  @Matches(/^[A-Z][A-Z0-9_]*$/, {
    message: "Qoida kodi katta harflar, raqam va pastki chiziqdan iborat bo'lsin",
  })
  code!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  label!: string;

  @IsEnum(TariffRuleOperation)
  operation!: TariffRuleOperation;

  @IsString()
  @Matches(DECIMAL_2, { message: "Qoida summasi Decimal formatda bo'lsin" })
  amount!: string;

  @IsInt()
  @Min(0)
  @Max(1000)
  priority!: number;
}

export class CreateTariffDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsEnum(TariffScope)
  scope!: TariffScope;

  @IsOptional()
  @IsUUID()
  routeId?: string;

  @IsString()
  @Matches(DECIMAL_2)
  baseAmount!: string;

  @IsString()
  @Matches(DECIMAL_2)
  pricePerKm!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => TariffRuleDto)
  rules?: TariffRuleDto[];
}

export class SetTariffActiveDto {
  @IsBoolean()
  isActive!: boolean;
}

export class CalculateTariffDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d{1,8}(\.\d{1,2})?$/, {
    message: "Masofa noto'g'ri formatda",
  })
  distanceKm?: string;
}
