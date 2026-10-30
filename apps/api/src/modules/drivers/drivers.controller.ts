import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { CurrentUser, Roles } from "../../common/auth/decorators";
import type { AuthenticatedUser } from "../../common/auth/auth.types";
import { DriversService } from "./drivers.service";
import { DRIVER_PHOTO_KINDS, DriverPhotoKind } from "./documents";
import { TelegramFiles } from "./telegram-files";
import {
  AssignDriverDto,
  CreateDriverDto,
  CreateDriverPaymentDto,
  UnassignDriverDto,
  UpdateDriverDocumentsDto,
  UpdateDriverDto,
  UpdateMonthlyPlanDto,
} from "./dto/driver.dto";

function ip(request: Request): string | null {
  return request.ip ?? request.socket?.remoteAddress ?? null;
}

const READ_ROLES = [
  UserRole.OWNER,
  UserRole.ADMIN,
  UserRole.ACCOUNTANT,
  UserRole.MANAGER,
] as const;

@ApiTags("drivers")
@ApiBearerAuth()
@Controller("drivers")
export class DriversController {
  constructor(
    private readonly drivers: DriversService,
    private readonly telegramFiles: TelegramFiles,
  ) {}

  @Get()
  @Roles(...READ_ROLES)
  list(@CurrentUser() user: AuthenticatedUser, @Query("q") query?: string) {
    return this.drivers.list(user.tenantId, query);
  }

  @Get("search")
  @Roles(...READ_ROLES)
  search(@CurrentUser() user: AuthenticatedUser, @Query("q") query?: string) {
    return this.drivers.search(user.tenantId, query);
  }

  @Get(":id")
  @Roles(...READ_ROLES)
  profile(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    return this.drivers.profile(user.tenantId, id);
  }

  @Post()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateDriverDto,
    @Req() request: Request,
  ) {
    return this.drivers.create(user, dto, ip(request));
  }

  @Patch(":id")
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateDriverDto,
    @Req() request: Request,
  ) {
    return this.drivers.update(user, id, dto, ip(request));
  }

  @Patch(":id/documents")
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  updateDocuments(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateDriverDocumentsDto,
    @Req() request: Request,
  ) {
    return this.drivers.updateDocuments(
      user.tenantId,
      id,
      dto,
      { userId: user.userId, source: "PANEL" },
      ip(request),
    );
  }

  @Get(":id/photo/:kind")
  @Roles(...READ_ROLES)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async photo(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Param("kind") kind: string,
    @Res() response: Response,
  ) {
    if (!(DRIVER_PHOTO_KINDS as readonly string[]).includes(kind)) {
      response.status(404).json({ message: "Rasm turi noto'g'ri" });
      return;
    }
    const fileId = await this.drivers.photoFileId(user.tenantId, id, kind as DriverPhotoKind);
    const file = await this.telegramFiles.download(fileId);
    response
      .status(200)
      .setHeader("Content-Type", file.contentType)
      .setHeader("Cache-Control", "private, max-age=300")
      .setHeader("X-Content-Type-Options", "nosniff")
      .send(file.body);
  }

  @Post(":id/assign")
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  assign(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: AssignDriverDto,
    @Req() request: Request,
  ) {
    return this.drivers.assign(user, id, dto, ip(request));
  }

  @Post(":id/unassign")
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  unassign(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: UnassignDriverDto,
    @Req() request: Request,
  ) {
    return this.drivers.unassign(user, id, dto, ip(request));
  }

  @Post(":id/telegram-link")
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  telegramLink(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Req() request: Request,
  ) {
    return this.drivers.createTelegramLink(user, id, ip(request));
  }
}

@ApiTags("billing")
@ApiBearerAuth()
@Controller("billing")
export class BillingController {
  constructor(private readonly drivers: DriversService) {}

  @Get("daily")
  @Roles(...READ_ROLES)
  daily(
    @CurrentUser() user: AuthenticatedUser,
    @Query("date") date?: string,
    @Query("q") query?: string,
  ) {
    return this.drivers.daily(user.tenantId, date, query);
  }

  @Get("payments")
  @Roles(...READ_ROLES)
  payments(
    @CurrentUser() user: AuthenticatedUser,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("q") q?: string,
    @Query("driverId") driverId?: string,
    @Query("limit") limit?: string,
  ) {
    return this.drivers.listPayments(user.tenantId, {
      from,
      to,
      q,
      driverId,
      limit,
    });
  }

  @Post("payments")
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.ACCOUNTANT)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  createPayment(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateDriverPaymentDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() request: Request,
  ) {
    return this.drivers.createPayment(user, dto, idempotencyKey ?? "", ip(request));
  }

  @Get("report")
  @Roles(...READ_ROLES)
  report(@CurrentUser() user: AuthenticatedUser, @Query("month") month?: string) {
    return this.drivers.report(user.tenantId, month);
  }

  @Patch("plans/:id")
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.ACCOUNTANT)
  updatePlan(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateMonthlyPlanDto,
    @Req() request: Request,
  ) {
    return this.drivers.updatePlan(user, id, dto, ip(request));
  }
}
