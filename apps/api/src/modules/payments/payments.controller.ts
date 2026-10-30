import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { UserRole } from "@prisma/client";
import type { Request } from "express";
import { CurrentUser, Public, Roles } from "../../common/auth/decorators";
import type { AuthenticatedUser } from "../../common/auth/auth.types";
import { PaymentsService } from "./payments.service";
import { PaymeService } from "./payme.service";
import {
  CompleteRefundDto,
  CreatePaymentDto,
  MarkPaymentPaidDto,
  RefundPaymentDto,
  RunReconciliationDto,
} from "./dto/payment.dto";

function ip(request: Request): string | null {
  return request.ip ?? request.socket?.remoteAddress ?? null;
}

@ApiTags("payments")
@ApiBearerAuth()
@Controller("payments")
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly payme: PaymeService,
  ) {}

  @Get()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.ACCOUNTANT)
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.payments.list(user.tenantId);
  }

  @Get("refunds")
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.ACCOUNTANT)
  listRefunds(@CurrentUser() user: AuthenticatedUser) {
    return this.payme.listRefunds(user.tenantId);
  }

  @Get("reconciliation")
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.ACCOUNTANT)
  listReconciliation(@CurrentUser() user: AuthenticatedUser) {
    return this.payme.listReconciliation(user.tenantId);
  }

  @Post()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.ACCOUNTANT)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePaymentDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() request: Request,
  ) {
    return this.payments.createManual(
      user,
      dto,
      idempotencyKey?.trim() ?? "",
      ip(request),
    );
  }

  @Post(":id/mark-paid")
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.ACCOUNTANT)
  markPaid(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: MarkPaymentPaidDto,
    @Req() request: Request,
  ) {
    return this.payments.markPaid(user, id, dto, ip(request));
  }

  @Post(":id/checkout-link")
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.ACCOUNTANT)
  checkoutLink(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Req() request: Request,
  ) {
    return this.payme.createCheckoutLink(user, id, ip(request));
  }

  @Post(":id/refund")
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.ACCOUNTANT)
  refund(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: RefundPaymentDto,
    @Req() request: Request,
  ) {
    return this.payme.requestRefund(user, id, dto, ip(request));
  }

  @Post("refunds/:id/complete")
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  completeRefund(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: CompleteRefundDto,
    @Req() request: Request,
  ) {
    return this.payme.completeRefund(user, id, dto, ip(request));
  }

  @Post("reconciliation/run")
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  runReconciliation(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RunReconciliationDto,
  ) {
    const from = new Date(dto.from);
    const to = new Date(dto.to);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException("Davr sanalari yaroqsiz");
    }
    return this.payme.runReconciliation(
      user.tenantId,
      dto.provider ?? "PAYME",
      { from, to },
      user.userId,
    );
  }
}

@ApiTags("webhooks")
@Controller("webhooks/payments")
export class PaymentWebhooksController {
  constructor(private readonly payments: PaymentsService) {}

  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @HttpCode(200)
  @Post(":provider")
  handle(
    @Param("provider") provider: string,
    @Body() _body: unknown,
    @Headers("x-webhook-timestamp") timestamp: string | undefined,
    @Headers("x-webhook-signature") signature: string | undefined,
    @Req() request: Request & { rawBody?: Buffer },
  ) {
    const raw = request.rawBody;
    if (!raw || raw.length === 0) {
      throw new BadRequestException("Webhook raw body mavjud emas");
    }
    if (raw.length > 1_000_000) {
      throw new BadRequestException("Webhook hajmi juda katta");
    }
    return this.payments.handleWebhook({
      provider,
      rawBody: raw.toString("utf8"),
      timestamp,
      signature,
      ip: ip(request),
    });
  }
}
