import { IsDateString, IsInt, IsNumber, IsOptional, IsString, MaxLength, Min } from "class-validator";
import { Type } from "class-transformer";

export class CloseWaybillDto {
  @IsOptional()
  @IsDateString()
  returnTime?: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  endOdometer!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  fuelAfter?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  specialNotes?: string;
}
