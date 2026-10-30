import { Transform } from "class-transformer";
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
import { VehicleStatus } from "@prisma/client";

const normalizePlate = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim().toUpperCase() : value;

export class CreateVehicleDto {
  @IsUUID()
  ownerId!: string;

  @Transform(normalizePlate)
  @IsString()
  @MinLength(3)
  @MaxLength(20)
  @Matches(/^[A-Z0-9 -]+$/, { message: "Davlat raqami noto'g'ri formatda" })
  plateNumber!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  model!: string;

  @IsInt()
  @Min(0)
  @Max(120)
  capacity!: number;

  @IsOptional()
  @IsEnum(VehicleStatus)
  status?: VehicleStatus;
}

export class UpdateVehicleDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  model?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(120)
  capacity?: number;

  @IsOptional()
  @IsEnum(VehicleStatus)
  status?: VehicleStatus;

  /** Oylik plan normasi (haydovchidan olinadigan oylik summa). */
  @IsOptional()
  @IsString()
  @Matches(/^\d{1,16}(\.\d{1,2})?$/, {
    message: "Oylik summa Decimal formatda bo'lishi kerak",
  })
  monthlyFee?: string;

  /** null — yo'nalishdan chiqarish. */
  @IsOptional()
  @IsUUID()
  routeId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
