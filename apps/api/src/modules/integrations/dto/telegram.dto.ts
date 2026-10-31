import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";
import { DRIVER_DOCUMENT_FIELDS } from "../../drivers/documents";

const CHAT_ID = /^-?\d{5,20}$/;

export class LinkTelegramDto {
  @IsString()
  @MinLength(20)
  @MaxLength(100)
  token!: string;

  @IsString()
  @Matches(CHAT_ID, { message: "chatId noto'g'ri" })
  chatId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  username?: string;
}

export class TelegramProfileDto {
  @IsString()
  @Matches(CHAT_ID, { message: "chatId noto'g'ri" })
  chatId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  username?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  lastName?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{20,255}$/)
  photoFileId?: string;
}

/**
 * Bot raqamni faqat Telegram "kontakt ulashish" tugmasidan, egasi o'zi
 * tasdiqlagan holda (contact.user_id === from.id) yuboradi.
 */
export class LinkPhoneDto extends TelegramProfileDto {
  @IsString()
  @Matches(/^\+?[\d\s()-]{9,20}$/, { message: "Telefon raqami noto'g'ri" })
  phone!: string;
}

export class DriverDocumentDto {
  @IsString()
  @Matches(CHAT_ID, { message: "chatId noto'g'ri" })
  chatId!: string;

  @IsIn(DRIVER_DOCUMENT_FIELDS as unknown as string[])
  field!: (typeof DRIVER_DOCUMENT_FIELDS)[number];

  @IsString()
  @MaxLength(255)
  value!: string;
}

export class SubmitReceiptBotDto {
  @IsString()
  @Matches(CHAT_ID, { message: "chatId noto'g'ri" })
  chatId!: string;

  @IsString()
  amount!: string;

  @IsString()
  base64Data!: string;

  @IsString()
  filename!: string;

  @IsOptional()
  @IsString()
  transactionNumber?: string;

  @IsOptional()
  @IsString()
  note?: string;
}
