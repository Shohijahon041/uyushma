import { Body, Controller, Get, Post, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import type { Request } from "express";
import { CurrentUser, Roles } from "../../common/auth/decorators";
import type { AuthenticatedUser } from "../../common/auth/auth.types";
import { SubscriptionsService } from "./subscriptions.service";
import { ChangePlanDto } from "./dto/subscription.dto";

function ip(request: Request): string | null {
  return request.ip ?? request.socket?.remoteAddress ?? null;
}

@ApiTags("subscriptions")
@ApiBearerAuth()
@Controller()
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Get("plans")
  plans(@CurrentUser() user: AuthenticatedUser) {
    return this.subscriptions.listPlans(user.tenantId);
  }

  @Get("subscriptions/current")
  current(@CurrentUser() user: AuthenticatedUser) {
    return this.subscriptions.current(user.tenantId);
  }

  @Get("subscriptions/invoices")
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.ACCOUNTANT)
  invoices(@CurrentUser() user: AuthenticatedUser) {
    return this.subscriptions.listInvoices(user.tenantId);
  }

  @Post("subscriptions/change-plan")
  @Roles(UserRole.OWNER)
  changePlan(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePlanDto,
    @Req() request: Request,
  ) {
    return this.subscriptions.changePlan(user, dto, ip(request));
  }

  @Post("subscriptions/invoices/generate")
  @Roles(UserRole.OWNER)
  generateInvoice(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.subscriptions.generateInvoice(user, ip(request));
  }
}
