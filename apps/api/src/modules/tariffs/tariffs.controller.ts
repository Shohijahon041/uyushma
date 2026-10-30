import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import type { Request } from "express";
import { CurrentUser, Roles } from "../../common/auth/decorators";
import type { AuthenticatedUser } from "../../common/auth/auth.types";
import { TariffsService } from "./tariffs.service";
import {
  CalculateTariffDto,
  CreateTariffDto,
  SetTariffActiveDto,
} from "./dto/tariff.dto";

function ip(request: Request): string | null {
  return request.ip ?? request.socket?.remoteAddress ?? null;
}

@ApiTags("tariffs")
@ApiBearerAuth()
@Controller("tariffs")
export class TariffsController {
  constructor(private readonly tariffs: TariffsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.tariffs.list(user.tenantId);
  }

  @Post()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateTariffDto,
    @Req() request: Request,
  ) {
    return this.tariffs.create(user, dto, ip(request));
  }

  @Patch(":id/status")
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  setActive(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: SetTariffActiveDto,
    @Req() request: Request,
  ) {
    return this.tariffs.setActive(user, id, dto.isActive, ip(request));
  }

  @Post(":id/calculate")
  calculate(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: CalculateTariffDto,
  ) {
    return this.tariffs.calculate(user.tenantId, id, dto);
  }
}
