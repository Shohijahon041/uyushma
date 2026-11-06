import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type { ExternalProvider } from "@prisma/client";
import type { Request, Response } from "express";
import { CurrentUser, Public, Roles } from "../../common/auth/decorators";
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
import { LocalConnectorService } from "./local-connector.service";

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
    private readonly localConnector: LocalConnectorService,
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
   * Kompyuterdagi "Uyushma ulagich" skripti uchun bir martalik kod.
   * Skript Chrome oynasini ochadi, login tugagach tokenni avtomatik yuboradi.
   */
  @Post(":provider/browser-pairing")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  browserPairing(
    @CurrentUser() user: AuthenticatedUser,
    @Param("provider") provider: string,
  ) {
    return this.localConnector.issue(user, providerOf(provider));
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
  syncAll(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.external.enqueueSync(user.tenantId, undefined, user.userId, ip(request));
  }

  @Post(":provider/sync")
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  sync(
    @CurrentUser() user: AuthenticatedUser,
    @Param("provider") provider: string,
    @Req() request: Request,
  ) {
    return this.external.enqueueSync(user.tenantId, providerOf(provider), user.userId, ip(request));
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
   * Yo'l inspeksiyasi (YPX / Transport nazorati) va yo'lovchilar uchun
   * davlat raqami bo'yicha avtomobilning raqamli yo'l pasportini tekshirish (Ommaviy QR)
   */
  @Public()
  @Get("public-verify/:plateNumber")
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async publicVerify(@Param("plateNumber") plateNumber: string) {
    const passport = await this.crossLink.getPublicPassport(plateNumber);
    if (!passport) {
      throw new NotFoundException("Avtomobil ma'lumotlari reyestrdan topilmadi");
    }
    return passport;
  }

  /**
   * QR Pasport uchun grafik QR kod (PNG). Telegram bot va chop etish uchun ishlatiladi.
   */
  @Public()
  @Get("public-verify/:plateNumber/qr")
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async publicVerifyQr(
    @Param("plateNumber") plateNumber: string,
    @Res() response: Response,
  ) {
    const passport = await this.crossLink.getPublicPassport(plateNumber);
    if (!passport) {
      throw new NotFoundException("Avtomobil ma'lumotlari reyestrdan topilmadi");
    }
    const png = await this.crossLink.buildPassportQr(passport.plateNumber);
    response.setHeader("Content-Type", "image/png");
    response.setHeader("Cache-Control", "public, max-age=300");
    response.setHeader(
      "Content-Disposition",
      `inline; filename="qr-${passport.plateNumber}.png"`,
    );
    response.send(png);
  }

  /**
   * QR Pasportning chop etiladigan PDF varianti.
   * Haydovchi, korxona va inspeksiya yuklab olishi mumkin.
   */
  @Public()
  @Get("public-verify/:plateNumber/pdf")
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async publicVerifyPdf(
    @Param("plateNumber") plateNumber: string,
    @Res() response: Response,
  ) {
    const passport = await this.crossLink.getPublicPassport(plateNumber);
    if (!passport) {
      throw new NotFoundException("Avtomobil ma'lumotlari reyestrdan topilmadi");
    }
    const pdf = await this.crossLink.buildPassportPdf(passport);
    response.setHeader("Content-Type", "application/pdf");
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="ijara-malumotnoma-${passport.plateNumber}.pdf"`,
    );
    response.send(pdf);
  }
}
