import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from "class-validator";

export const ALLOWED_DOCUMENT_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export class CreateUploadDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  fileName!: string;

  @IsIn(ALLOWED_DOCUMENT_TYPES, { message: "Fayl turi qo'llab-quvvatlanmaydi" })
  contentType!: (typeof ALLOWED_DOCUMENT_TYPES)[number];

  @IsInt()
  @Min(1)
  @Max(20 * 1024 * 1024, { message: "Fayl hajmi 20 MB dan oshmasligi kerak" })
  sizeBytes!: number;

  @IsOptional()
  @IsUUID()
  contractId?: string;
}
