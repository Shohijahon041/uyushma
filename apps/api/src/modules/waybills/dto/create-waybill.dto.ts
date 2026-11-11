import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from "class-validator";
import { Type } from "class-transformer";

export class CreateWaybillDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  number?: string;

  @IsDateString()
  date!: string;

  @IsOptional()
  @IsDateString()
  validUntil?: string;

  @IsUUID()
  driverId!: string;

  @IsUUID()
  vehicleId!: string;

  @IsOptional()
  @IsUUID()
  routeId?: string;

  @IsOptional()
  @IsBoolean()
  medicalPassed?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  medicalDoctorName?: string;

  @IsOptional()
  @IsDateString()
  medicalCheckedAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  medicalNotes?: string;

  @IsOptional()
  @IsBoolean()
  technicalPassed?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  mechanicName?: string;

  @IsOptional()
  @IsDateString()
  technicalCheckedAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  technicalNotes?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  startOdometer?: number;

  @IsOptional()
  @IsDateString()
  departureTime?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  fuelType?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  fuelBefore?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  fuelGiven?: number;

  @IsOptional()
  @IsBoolean()
  assignDriver?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  dispatcherName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  specialNotes?: string;
}
