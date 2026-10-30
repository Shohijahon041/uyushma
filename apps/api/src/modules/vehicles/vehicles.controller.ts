import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import type { Request } from "express";
import { CurrentUser, Roles } from "../../common/auth/decorators";
import type { AuthenticatedUser } from "../../common/auth/auth.types";
import { VehiclesService } from "./vehicles.service";
import { CreateVehicleDto, UpdateVehicleDto } from "./dto/vehicle.dto";

function ip(request: Request): string | null {
  return request.ip ?? request.socket?.remoteAddress ?? null;
}

@ApiTags("vehicles")
@ApiBearerAuth()
@Controller("vehicles")
export class VehiclesController {
  constructor(private readonly vehicles: VehiclesService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query("includeInactive") includeInactive?: string,
  ) {
    return this.vehicles.list(user.tenantId, includeInactive === "true");
  }

  @Post()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateVehicleDto,
    @Req() request: Request,
  ) {
    return this.vehicles.create(user, dto, ip(request));
  }

  @Patch(":id")
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateVehicleDto,
    @Req() request: Request,
  ) {
    return this.vehicles.update(user, id, dto, ip(request));
  }
}
