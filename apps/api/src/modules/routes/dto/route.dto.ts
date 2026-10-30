import {
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

const DECIMAL_2 = /^\d{1,8}(\.\d{1,2})?$/;
const MONEY = /^\d{1,16}(\.\d{1,2})?$/;

export class CreateRouteDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(160)
  origin!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(160)
  destination!: string;

  @IsString()
  @Matches(DECIMAL_2, { message: "Masofa 2 xonagacha qadam bilan yozilishi kerak" })
  distanceKm!: string;

  /** Yo'nalishdagi har bir avtomobil uchun oylik plan (shaxsiy norma bo'lmasa). */
  @IsOptional()
  @IsString()
  @Matches(MONEY, { message: "Oylik plan Decimal formatda bo'lishi kerak" })
  monthlyPlan?: string;
}

export class UpdateRouteDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  origin?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  destination?: string;

  @IsOptional()
  @IsString()
  @Matches(DECIMAL_2)
  distanceKm?: string;

  @IsOptional()
  @IsString()
  @Matches(MONEY, { message: "Oylik plan Decimal formatda bo'lishi kerak" })
  monthlyPlan?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
