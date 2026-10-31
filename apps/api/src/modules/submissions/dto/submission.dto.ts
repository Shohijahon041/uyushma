import { IsNotEmpty, IsNumberString, IsOptional, IsString, IsUUID, MaxLength } from "class-validator";

export class CreateSubmissionDto {
  @IsUUID()
  @IsNotEmpty()
  driverId!: string;

  @IsUUID()
  @IsOptional()
  vehicleId?: string;

  @IsNumberString()
  @IsNotEmpty()
  amount!: string;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  transactionNumber?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  note?: string;
}

export class ApproveSubmissionDto {
  @IsString()
  @IsOptional()
  @MaxLength(500)
  note?: string;
}

export class RejectSubmissionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

export class UpdateCompanyPaymentDetailsDto {
  @IsString()
  @IsOptional()
  @MaxLength(32)
  paymentCardNumber?: string;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  paymentCardHolder?: string;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  paymentCardBank?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  paymentInstructions?: string;
}

