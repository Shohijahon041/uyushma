import {
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";
import { PaymentMethod, PaymentProvider } from "@prisma/client";

const DECIMAL_2 = /^\d{1,16}(\.\d{1,2})?$/;

export class CreatePaymentDto {
  @IsUUID()
  contractId!: string;

  @IsString()
  @Matches(DECIMAL_2, { message: "Summa Decimal formatda bo'lishi kerak" })
  amount!: string;

  @IsEnum(PaymentMethod)
  method!: PaymentMethod;

  @IsOptional()
  @IsEnum(PaymentProvider)
  provider?: PaymentProvider;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class MarkPaymentPaidDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class CreatePaymentHeadersDto {
  // Validated imperatively in the controller so the error is clear.
  idempotencyKey?: string;
}

export class RefundPaymentDto {
  @IsString()
  @Matches(DECIMAL_2, { message: "Summa Decimal formatda bo'lishi kerak" })
  amount!: string;

  @IsString()
  @MinLength(4)
  @MaxLength(500)
  reason!: string;
}

export class CompleteRefundDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  externalRef?: string;
}

export class UpsertPaymeAccountDto {
  @IsString()
  @MinLength(4)
  @MaxLength(80)
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: "Merchant ID faqat harf, raqam, defis va pastki chiziqdan iborat bo'lsin",
  })
  merchantId!: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(80)
  login?: string;

  @IsString()
  @MinLength(8)
  @MaxLength(200)
  secret!: string;

  @IsOptional()
  @IsString()
  @MinLength(16)
  @MaxLength(200)
  webhookSecret?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class RunReconciliationDto {
  @IsOptional()
  @IsEnum(PaymentProvider)
  provider?: PaymentProvider;

  @IsISO8601()
  from!: string;

  @IsISO8601()
  to!: string;
}
