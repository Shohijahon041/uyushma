import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type { ExternalProvider } from "@prisma/client";
import type { Request } from "express";
import { CurrentUser, Roles } from "../../common/auth/decorators";
import type { AuthenticatedUser } from "../../common/auth/auth.types";
import {
  RecordsQueryDto,
  SaveConnectionDto,
  SyncQueryDto,
  VehiclesQueryDto,
} from "./dto/external.dto";
import { ExternalService } from "./external.service";

function providerOf(value: string): ExternalProvider {
  if (value === "ETENDER" || value === "AUTOPARK") return value;
  throw new BadRequestException("Provayder ETENDER yoki AUTOPARK bo'lishi kerak");
}

function ip(request: Request): string | null {
  return request.ip ?? request.socket?.remoteAddress ?? null;
}

@ApiTags("integrations")
@ApiBearerAuth()
@Roles("OWNER", "ADMIN")
@Controller("settings/integrations")
export class ExternalSettingsController {
  constructor(private readonly external: ExternalService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.external.listConnections(user.tenantId);
  }

  @Put(":provider")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  save(
    @CurrentUser() user: AuthenticatedUser,
    @Param("provider") provider: string,
    @Body() dto: SaveConnectionDto,
    @Req() request: Request,
  ) {
    return this.external.saveConnection(
      user,
      providerOf(provider),
      dto,
      ip(request),
    );
  }

  @Post(":provider/sync")
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  sync(
    @CurrentUser() user: AuthenticatedUser,
    @Param("provider") provider: string,
  ) {
    return this.external.enqueueSync(user.tenantId, providerOf(provider));
  }

  @Post(":provider/disable")
  disable(
    @CurrentUser() user: AuthenticatedUser,
    @Param("provider") provider: string,
    @Req() request: Request,
  ) {
    return this.external.disableConnection(
      user,
      providerOf(provider),
      ip(request),
    );
  }

  @Get("runs")
  runs(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: SyncQueryDto,
  ) {
    return this.external.listRuns(user.tenantId, query.limit ?? 20);
  }
}

@ApiTags("registry")
@ApiBearerAuth()
@Controller("registry")
export class RegistryController {
  constructor(private readonly external: ExternalService) {}

  @Get("vehicles")
  vehicles(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: VehiclesQueryDto,
  ) {
    return this.external.listVehicles(user.tenantId, query);
  }

  @Get("records")
  records(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: RecordsQueryDto,
  ) {
    return this.external.listRecords(user.tenantId, query);
  }

  @Get("runs")
  runs(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: SyncQueryDto,
  ) {
    return this.external.listRuns(user.tenantId, query.limit ?? 20);
  }
}
