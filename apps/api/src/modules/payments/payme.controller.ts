import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Put,
  Req,
} from "@nestjs/common";
import { ApiBearerAuth, ApiExcludeController, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { UserRole } from "@prisma/client";
import type { Request } from "express";
import { CurrentUser, Public, Roles } from "../../common/auth/decorators";
import type { AuthenticatedUser } from "../../common/auth/auth.types";
import { PaymeService } from "./payme.service";
import { UpsertPaymeAccountDto } from "./dto/payment.dto";

function clientIp(request: Request): string | null {
  return request.ip ?? request.socket?.remoteAddress ?? null;
}

/**
 * Payme Merchant API speaks JSON-RPC 2.0 at the merchant's single endpoint.
 * The tenant is resolved from the URL slug or, when Payme only sends
 * `account.order_id`, from the payment row itself.
 */
@ApiExcludeController()
@Controller("webhooks/payments/payme")
export class PaymeWebhookController {
  constructor(private readonly payme: PaymeService) {}

  @Public()
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  @HttpCode(200)
  @Post()
  handleRoot(
    @Body() _body: unknown,
    @Headers("authorization") authorization: string | undefined,
    @Req() request: Request & { rawBody?: Buffer },
  ) {
    return this.handle(null, authorization, request);
  }

  @Public()
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  @HttpCode(200)
  @Post(":tenantSlug")
  handleTenant(
    @Param("tenantSlug") tenantSlug: string,
    @Body() _body: unknown,
    @Headers("authorization") authorization: string | undefined,
    @Req() request: Request & { rawBody?: Buffer },
  ) {
    return this.handle(tenantSlug, authorization, request);
  }

  private handle(
    tenantSlug: string | null,
    authorization: string | undefined,
    request: Request & { rawBody?: Buffer },
  ) {
    const raw = request.rawBody;
    if (!raw || raw.length === 0) {
      throw new BadRequestException("Webhook raw body mavjud emas");
    }
    if (raw.length > 1_000_000) {
      throw new BadRequestException("Webhook hajmi juda katta");
    }
    return this.payme.handleRpc({
      tenantSlug,
      rawBody: raw.toString("utf8"),
      authorization,
      ip: clientIp(request),
    });
  }
}

@ApiTags("settings")
@ApiBearerAuth()
@Controller("settings/payments/payme")
export class PaymeSettingsController {
  constructor(private readonly payme: PaymeService) {}

  @Get()
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.payme.getAccount(user.tenantId);
  }

  @Put()
  @Roles(UserRole.OWNER)
  upsert(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpsertPaymeAccountDto,
    @Req() request: Request,
  ) {
    return this.payme.upsertAccount(user, dto, clientIp(request));
  }
}
