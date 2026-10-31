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
  EImzoLoginRequestDto,
  OneIdConnectAllRequestDto,
  RecordsQueryDto,
  SaveConnectionDto,
  SyncQueryDto,
  VehiclesQueryDto,
} from "./dto/external.dto";
import { ExternalService } from "./external.service";
import { OneIdAuthService } from "./connectors/oneid.service";
import { EImzoService } from "./connectors/eimzo.service";
import { ExternalCrossLinkService } from "./cross-link.service";

function providerOf(value: string): ExternalProvider {
  if (value === "ETENDER" || value === "AUTOPARK" || value === "IJARA") return value;
  throw new BadRequestException("Provayder ETENDER, AUTOPARK yoki IJARA bo'lishi kerak");
}

function ip(request: Request): string | null {
  return request.ip ?? request.socket?.remoteAddress ?? null;
}

@ApiTags("integrations")
@ApiBearerAuth()
@Roles("OWNER", "ADMIN")
@Controller("settings/integrations")
export class ExternalSettingsController {
  constructor(
    private readonly external: ExternalService,
    private readonly oneIdAuth: OneIdAuthService,
    private readonly eimzo: EImzoService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.external.listConnections(user.tenantId);
  }

  /**
   * Bitta OneID orqali 3 ta saytga (bm.dtransport.uz, e-tender.uztrans.uz, ijara.soliq.uz) bir vaqtda ulanish
   */
  @Post("oneid/connect-all")
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  connectAllOneId(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: OneIdConnectAllRequestDto,
    @Req() request: Request,
  ) {
    return this.oneIdAuth.connectAll(user, dto, ip(request));
  }

  /**
   * ijara.soliq.uz uchun E-IMZO challenge olish
   */
  @Get("ijara/eimzo/challenge")
  getEImzoChallenge(@CurrentUser() user: AuthenticatedUser) {
    return this.eimzo.generateChallenge(user.tenantId);
  }

  /**
   * ijara.soliq.uz uchun E-IMZO PKCS#7 imzosi orqali kirish
   */
  @Post("ijara/eimzo/login")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  loginEImzo(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: EImzoLoginRequestDto,
    @Req() request: Request,
  ) {
    return this.eimzo.loginWithEImzo(user, dto, ip(request));
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
  constructor(
    private readonly external: ExternalService,
    private readonly crossLink: ExternalCrossLinkService,
  ) {}

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

  /**
   * 3 ta portal ma'lumotlarini bitta 360° reyestrda ko'rish
   */
  @Get("cross-link")
  getCrossLinkedRegistry(@CurrentUser() user: AuthenticatedUser) {
    return this.crossLink.getUnifiedRegistry(user.tenantId);
  }

  /**
   * 3 ta portal ma'lumotlarini avtomatik platforma transportlari va haydovchilari bilan bog'lash
   */
  @Post("cross-link/auto")
  @Roles("OWNER", "ADMIN")
  autoCrossLink(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.crossLink.autoLinkAll(user, ip(request));
  }
}
