import { PartialType } from "@nestjs/mapped-types";
import { IsDateString, IsEnum, IsInt, IsNumber, IsOptional, Min } from "class-validator";
import { Type } from "class-transformer";
import { WaybillStatus } from "@prisma/client";
import { CreateWaybillDto } from "./create-waybill.dto";

export class UpdateWaybillDto extends PartialType(CreateWaybillDto) {
  @IsOptional()
  @IsEnum(WaybillStatus)
  status?: WaybillStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  endOdometer?: number;

  @IsOptional()
  @IsDateString()
  returnTime?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  fuelAfter?: number;
}
