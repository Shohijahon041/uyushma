import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";
import { CurrentUser, Public } from "../../common/auth/decorators";
import { BotApiGuard } from "../../common/auth/service-guards";
import type { AuthenticatedUser } from "../../common/auth/auth.types";
import { IntegrationsService } from "./integrations.service";
import {
  DriverDocumentDto,
  EndShiftBotDto,
  LinkPhoneDto,
  LinkTelegramDto,
  ReportIncidentBotDto,
  StartShiftBotDto,
  SubmitReceiptBotDto,
  TelegramProfileDto,
} from "./dto/telegram.dto";

function ip(request: Request): string | null {
  return request.ip ?? request.socket?.remoteAddress ?? null;
}

@ApiTags("settings")
@ApiBearerAuth()
@Controller("settings/telegram")
export class TelegramSettingsController {
  constructor(private readonly integrations: IntegrationsService) {}

  @Get()
  status(@CurrentUser() user: AuthenticatedUser) {
    return this.integrations.linkStatus(user.tenantId, user.userId);
  }

  @Post("link-token")
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  createToken(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.integrations.createLinkToken(user, ip(request));
  }
}

/**
 * Bot API. The Telegram bot holds only BOT_API_KEY; it never touches the
 * database and never sees another tenant's data.
 */
@ApiTags("integrations")
@Public()
@UseGuards(BotApiGuard)
@Controller("integrations/telegram")
export class TelegramBotController {
  constructor(private readonly integrations: IntegrationsService) {}

  @Post("link")
  @HttpCode(200)
  link(@Body() dto: LinkTelegramDto, @Req() request: Request) {
    return this.integrations.link(dto, ip(request));
  }

  @Get("profile")
  profile(@Query("chatId") chatId: string) {
    return this.integrations.botProfile(chatId);
  }

  @Get("summary")
  summary(@Query("chatId") chatId: string) {
    return this.integrations.botSummary(chatId);
  }

  @Get("contracts")
  contracts(@Query("chatId") chatId: string) {
    return this.integrations.botContracts(chatId);
  }

  @Get("payments")
  payments(@Query("chatId") chatId: string) {
    return this.integrations.botPayments(chatId);
  }

  @Get("balance")
  balance(@Query("chatId") chatId: string) {
    return this.integrations.botBalance(chatId);
  }

  @Get("whoami")
  whoami(@Query("chatId") chatId: string) {
    return this.integrations.whoami(chatId);
  }

  @Get("driver")
  driver(@Query("chatId") chatId: string) {
    return this.integrations.botDriver(chatId);
  }

  @Post("link-phone")
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  linkPhone(@Body() dto: LinkPhoneDto, @Req() request: Request) {
    return this.integrations.linkPhone(dto, ip(request));
  }

  @Post("driver/telegram-profile")
  @HttpCode(200)
  driverTelegramProfile(@Body() dto: TelegramProfileDto) {
    return this.integrations.syncDriverTelegram(dto);
  }

  @Get("driver/documents")
  driverDocuments(@Query("chatId") chatId: string) {
    return this.integrations.botDriverDocuments(chatId);
  }

  @Get("driver/photo")
  driverPhoto(
    @Query("chatId") chatId: string,
    @Query("kind") kind: string,
  ) {
    return this.integrations.botDriverPhoto(chatId, kind);
  }

  @Post("driver/documents")
  @HttpCode(200)
  updateDriverDocument(@Body() dto: DriverDocumentDto, @Req() request: Request) {
    return this.integrations.updateBotDriverDocument(dto, ip(request));
  }

  @Get("driver/payment-card")
  driverPaymentCard(@Query("chatId") chatId: string) {
    return this.integrations.botPaymentCard(chatId);
  }

  @Post("driver/submit-receipt")
  @HttpCode(200)
  submitReceipt(@Body() dto: SubmitReceiptBotDto) {
    return this.integrations.submitReceipt(dto);
  }

  @Post("driver/shift/start")
  @HttpCode(200)
  startShift(@Body() dto: StartShiftBotDto) {
    return this.integrations.botStartShift(dto);
  }

  @Post("driver/shift/end")
  @HttpCode(200)
  endShift(@Body() dto: EndShiftBotDto) {
    return this.integrations.botEndShift(dto);
  }

  @Get("driver/shift/current")
  currentShift(@Query("chatId") chatId: string) {
    return this.integrations.botCurrentShift(chatId);
  }

  @Post("driver/incident")
  @HttpCode(200)
  reportIncident(@Body() dto: ReportIncidentBotDto) {
    return this.integrations.botReportIncident(dto);
  }
}
