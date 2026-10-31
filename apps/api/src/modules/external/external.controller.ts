import {
  BadRequestException,
  Body,
  Controller,
  Delete,
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
  OneIdBrowserLoginDto,
  OneIdConnectAllRequestDto,
  OneIdExchangeCodeDto,
  RecordsQueryDto,
  SaveConnectionDto,
  SyncQueryDto,
  VehiclesQueryDto,
} from "./dto/external.dto";
import { ExternalService } from "./external.service";
import { OneIdAuthService } from "./connectors/oneid.service";
import { OneIdBrowserService } from "./connectors/oneid-browser.service";
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
    private readonly browserAuth: OneIdBrowserService,
    private readonly eimzo: EImzoService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.external.listConnections(user.tenantId);
  }

  /**
   * Serverda Playwright brauzeri (Chrome/Edge) mavjudligini qaytaradi
   */
  @Get("oneid/browser-status")
  getBrowserStatus() {
    return {
      available: this.browserAuth.isAvailable(),
      path: this.browserAuth.getExecutablePath(),
    };
  }

  /**
   * OneID OAuth2 rasmiy avtorizatsiya havolalarini qaytaradi
   */
  @Get("oneid/urls")
  getOneIdUrls() {
    return this.oneIdAuth.getSsoUrls();
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
   * Playwright orqali avtomatik OneID SSO kirish (Headless)
   */
  @Post(":provider/oneid-browser-login")
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async loginWithBrowser(
    @CurrentUser() user: AuthenticatedUser,
    @Param("provider") provider: string,
    @Body() dto: OneIdBrowserLoginDto,
    @Req() request: Request,
  ) {
    const prov = providerOf(provider);
    const browserResult = await this.browserAuth.loginAutomated(
      prov,
      dto.username,
      dto.password,
    );

    if (!browserResult.success || !browserResult.code) {
      throw new BadRequestException(
        browserResult.error ?? "OneID orqali kirish amalga oshmadi",
      );
    }

    return this.oneIdAuth.exchangeCode(user, prov, browserResult.code, ip(request));
  }

  /**
   * Playwright orqali ko'rinadigan brauzer oynasini ochish (Interactive)
   */
  @Post(":provider/oneid-browser-interactive")
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async launchInteractiveBrowser(
    @CurrentUser() user: AuthenticatedUser,
    @Param("provider") provider: string,
    @Req() request: Request,
  ) {
    const prov = providerOf(provider);
    const reqIp = ip(request);

    return this.browserAuth.launchInteractiveWindow(prov, async (code: string) => {
      await this.oneIdAuth.exchangeCode(user, prov, code, reqIp);
    });
  }

  /**
   * Aniq provayder uchun OneID kodini (yoki URL manzilini) tokenga almashtirish
   */
  @Post(":provider/oneid-exchange")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  exchangeOneIdCode(
    @CurrentUser() user: AuthenticatedUser,
    @Param("provider") provider: string,
    @Body() dto: OneIdExchangeCodeDto,
    @Req() request: Request,
  ) {
    return this.oneIdAuth.exchangeCode(
      user,
      providerOf(provider),
      dto.code,
      ip(request),
    );
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

  @Post("sync-all")
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  syncAll(@CurrentUser() user: AuthenticatedUser) {
    return this.external.enqueueSync(user.tenantId, undefined);
  }

  @Post(":provider/sync")
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  sync(
    @CurrentUser() user: AuthenticatedUser,
    @Param("provider") provider: string,
  ) {
    return this.external.enqueueSync(user.tenantId, providerOf(provider));
  }

  @Delete(":provider")
  delete(
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

  /**
   * Mavjud avtomobillar uchun Soliq ijara namunaviy shartnomalarini yuklash (Demo)
   */
  @Post("cross-link/seed-demo-ijara")
  @Roles("OWNER", "ADMIN")
  seedDemoIjara(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.crossLink.seedDemoIjaraContracts(user, ip(request));
  }
}
