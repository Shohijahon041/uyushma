import { Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";

export class ProviderCredentialsDto {
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  username!: string;

  @IsString()
  @MinLength(4)
  @MaxLength(200)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  ip?: string;
}

export class SaveConnectionDto {
  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  token?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ProviderCredentialsDto)
  credentials?: ProviderCredentialsDto;

  @IsOptional()
  @IsUrl({ require_tld: true, protocols: ["https"] })
  baseUrl?: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}

export class SyncQueryDto {
  @IsOptional()
  @IsIn(["ETENDER", "AUTOPARK", "IJARA"])
  provider?: "ETENDER" | "AUTOPARK" | "IJARA";

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}

export class VehiclesQueryDto extends SyncQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}

export class RecordsQueryDto {
  @IsIn([
    "CONTRACT_APPLICATION",
    "CONTRACT",
    "CERTIFICATE",
    "TENDER_APPLICATION",
    "RENT_CONTRACT",
  ])
  kind!:
    | "CONTRACT_APPLICATION"
    | "CONTRACT"
    | "CERTIFICATE"
    | "TENDER_APPLICATION"
    | "RENT_CONTRACT";

  @IsOptional()
  @IsIn(["ETENDER", "AUTOPARK", "IJARA"])
  provider?: "ETENDER" | "AUTOPARK" | "IJARA";

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}

export class OneIdConnectAllRequestDto {
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  username!: string;

  @IsString()
  @MinLength(4)
  @MaxLength(200)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  ip?: string;
}

export class EImzoLoginRequestDto {
  @IsString()
  @MinLength(10)
  challenge!: string;

  @IsString()
  @MinLength(50)
  pkcs7_64!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  serialNumber?: string;
}
