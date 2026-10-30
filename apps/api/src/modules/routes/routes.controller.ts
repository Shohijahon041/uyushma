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
import { RoutesService } from "./routes.service";
import { CreateRouteDto, UpdateRouteDto } from "./dto/route.dto";

function ip(request: Request): string | null {
  return request.ip ?? request.socket?.remoteAddress ?? null;
}

@ApiTags("routes")
@ApiBearerAuth()
@Controller("routes")
export class RoutesController {
  constructor(private readonly routes: RoutesService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.routes.list(user.tenantId);
  }

  @Post()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateRouteDto,
    @Req() request: Request,
  ) {
    return this.routes.create(user, dto, ip(request));
  }

  @Patch(":id")
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateRouteDto,
    @Req() request: Request,
  ) {
    return this.routes.update(user, id, dto, ip(request));
  }
}
