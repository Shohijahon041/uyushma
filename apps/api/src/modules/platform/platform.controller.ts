import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { CurrentUser } from "../../common/auth/decorators";
import type { AuthenticatedUser } from "../../common/auth/auth.types";
import {
  CreateLicenseContractDto,
  PlatformCreateCompanyDto,
  PlatformCreateUserDto,
  PlatformResetPasswordDto,
  PlatformUpdateUserDto,
  RecordSubscriptionPaymentDto,
  SetCompanyStatusDto,
} from "./dto/platform.dto";
import { PlatformService } from "./platform.service";

function ip(request: Request): string | null {
  return request.ip ?? request.socket?.remoteAddress ?? null;
}

const uuid = () => new ParseUUIDPipe();

@ApiTags("platform")
@ApiBearerAuth()
@Controller("platform")
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get("overview")
  overview(@CurrentUser() user: AuthenticatedUser) {
    return this.platform.overview(user);
  }

  @Post("companies")
  createCompany(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: PlatformCreateCompanyDto,
    @Req() request: Request,
  ) {
    return this.platform.createCompany(user, dto, ip(request));
  }

  @Post("companies/:id/status")
  setStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", uuid()) id: string,
    @Body() dto: SetCompanyStatusDto,
    @Req() request: Request,
  ) {
    return this.platform.setCompanyStatus(user, id, dto.status, ip(request));
  }

  @Get("users")
  users(@CurrentUser() user: AuthenticatedUser) {
    return this.platform.users(user);
  }

  @Post("companies/:companyId/users")
  createUser(
    @CurrentUser() user: AuthenticatedUser,
    @Param("companyId", uuid()) companyId: string,
    @Body() dto: PlatformCreateUserDto,
    @Req() request: Request,
  ) {
    return this.platform.createUser(user, companyId, dto, ip(request));
  }

  @Patch("companies/:companyId/users/:userId")
  updateUser(
    @CurrentUser() user: AuthenticatedUser,
    @Param("companyId", uuid()) companyId: string,
    @Param("userId", uuid()) userId: string,
    @Body() dto: PlatformUpdateUserDto,
    @Req() request: Request,
  ) {
    return this.platform.updateUser(user, companyId, userId, dto, ip(request));
  }

  @Post("companies/:companyId/users/:userId/reset-password")
  resetPassword(
    @CurrentUser() user: AuthenticatedUser,
    @Param("companyId", uuid()) companyId: string,
    @Param("userId", uuid()) userId: string,
    @Body() dto: PlatformResetPasswordDto,
    @Req() request: Request,
  ) {
    return this.platform.resetPassword(user, companyId, userId, dto, ip(request));
  }

  @Get("licenses")
  licenses(@CurrentUser() user: AuthenticatedUser) {
    return this.platform.listLicenses(user);
  }

  @Post("companies/:companyId/licenses")
  createLicense(
    @CurrentUser() user: AuthenticatedUser,
    @Param("companyId", uuid()) companyId: string,
    @Body() dto: CreateLicenseContractDto,
    @Req() request: Request,
  ) {
    return this.platform.createLicense(user, companyId, dto, ip(request));
  }

  @Post("companies/:companyId/subscription-payments")
  recordSubscriptionPayment(
    @CurrentUser() user: AuthenticatedUser,
    @Param("companyId", uuid()) companyId: string,
    @Body() dto: RecordSubscriptionPaymentDto,
    @Req() request: Request,
  ) {
    return this.platform.recordSubscriptionPayment(user, companyId, dto, ip(request));
  }
}
