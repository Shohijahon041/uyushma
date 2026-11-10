import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { UserRole } from "@prisma/client";
import type { Request, Response } from "express";
import { CurrentUser, Public, Roles } from "../../common/auth/decorators";
import type { AuthenticatedUser } from "../../common/auth/auth.types";
import { WaybillsService } from "./waybills.service";
import { CreateWaybillDto } from "./dto/create-waybill.dto";
import { UpdateWaybillDto } from "./dto/update-waybill.dto";
import { CloseWaybillDto } from "./dto/close-waybill.dto";
import { QueryWaybillDto } from "./dto/query-waybill.dto";

@ApiTags("waybills")
@Controller("waybills")
export class WaybillsController {
  constructor(private readonly waybills: WaybillsService) {}

  @Get()
  @ApiBearerAuth()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.ACCOUNTANT)
  async list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: QueryWaybillDto,
  ) {
    return this.waybills.list(actor.tenantId, query);
  }

  @Get("stats")
  @ApiBearerAuth()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.ACCOUNTANT)
  async stats(@CurrentUser() actor: AuthenticatedUser) {
    return this.waybills.stats(actor.tenantId);
  }

  @Get("next-number")
  @ApiBearerAuth()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  async nextNumber(@CurrentUser() actor: AuthenticatedUser) {
    return this.waybills.nextNumber(actor.tenantId);
  }

  // -------------------------------------------------------------------------
  // Onlayn tekshiruv (QR-kod orqali tekshiruv - avtorizatsiyasiz ochiq)
  // -------------------------------------------------------------------------
  @Public()
  @Get("public-verify/:token")
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async publicVerify(@Param("token") token: string) {
    const data = await this.waybills.getPublicWaybill(token);
    if (!data) {
      throw new NotFoundException("Yo'l varaqasi topilmadi yoki token yaroqsiz");
    }
    return data;
  }

  @Public()
  @Get("public-verify/:token/qr")
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async publicVerifyQr(
    @Param("token") token: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const webOrigin =
      process.env.APP_ORIGIN ??
      process.env.WEB_PUBLIC_URL ??
      `${req.protocol}://${req.get("host")}`;

    const buffer = await this.waybills.generateQrBuffer(token, webOrigin);
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(buffer);
  }

  // -------------------------------------------------------------------------
  // Yo'l varaqasi tafsilotlari va amallar
  // -------------------------------------------------------------------------
  @Get(":id")
  @ApiBearerAuth()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.ACCOUNTANT)
  async getById(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") id: string,
  ) {
    return this.waybills.getById(actor.tenantId, id);
  }

  @Get(":id/qr")
  @ApiBearerAuth()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.ACCOUNTANT)
  async getQr(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") id: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const waybill = await this.waybills.getById(actor.tenantId, id);
    const webOrigin =
      process.env.APP_ORIGIN ??
      process.env.WEB_PUBLIC_URL ??
      `${req.protocol}://${req.get("host")}`;

    const buffer = await this.waybills.generateQrBuffer(waybill.publicToken, webOrigin);
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.send(buffer);
  }

  @Post()
  @ApiBearerAuth()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  async create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateWaybillDto,
    @Req() req: Request,
  ) {
    return this.waybills.create(actor, dto, req.ip ?? null);
  }

  @Patch(":id")
  @ApiBearerAuth()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  async update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: UpdateWaybillDto,
    @Req() req: Request,
  ) {
    return this.waybills.update(actor.tenantId, id, dto, actor, req.ip ?? null);
  }

  @Post(":id/close")
  @ApiBearerAuth()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  async close(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: CloseWaybillDto,
    @Req() req: Request,
  ) {
    return this.waybills.close(actor.tenantId, id, dto, actor, req.ip ?? null);
  }

  @Post(":id/cancel")
  @ApiBearerAuth()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  async cancel(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") id: string,
    @Body("reason") reason: string | undefined,
    @Req() req: Request,
  ) {
    return this.waybills.cancel(actor.tenantId, id, reason, actor, req.ip ?? null);
  }
}
