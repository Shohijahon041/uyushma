import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from "class-validator";
import { ContractType } from "@prisma/client";

const DECIMAL_2 = /^\d{1,16}(\.\d{1,2})?$/;

export class CreateContractDto {
  @IsUUID()
  vehicleId!: string;

  @IsUUID()
  ownerId!: string;

  @IsOptional()
  @IsUUID()
  tariffId?: string;

  @IsEnum(ContractType)
  type!: ContractType;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "Sana YYYY-MM-DD formatda bo'lsin" })
  startDate!: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "Sana YYYY-MM-DD formatda bo'lsin" })
  endDate?: string;

  @IsOptional()
  @IsString()
  @Matches(DECIMAL_2, { message: "Oylik to'lov Decimal formatda bo'lsin" })
  monthlyRate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class TerminateContractDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  endDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
