import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";
import { Public } from "../../common/auth/decorators";
import { ExternalService } from "./external.service";
import { LOCAL_CONNECTOR_PORTALS, LocalConnectorService } from "./local-connector.service";
import { LocalConnectorCaptureDto } from "./dto/external.dto";

function ip(request: Request): string | null {
  return request.ip ?? request.socket?.remoteAddress ?? null;
}

/**
 * Kompyuterda ishlaydigan "Uyushma ulagich" skripti uchun ochiq endpointlar.
 * Autentifikatsiya o'rniga qisqa muddatli bir martalik pairing kodi ishlatiladi.
 */
@ApiExcludeController()
@Public()
@Controller("local-connector")
export class LocalConnectorController {
  constructor(
    private readonly external: ExternalService,
    private readonly pairing: LocalConnectorService,
  ) {}

  @Get("pairing/:code")
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  pairingInfo(@Param("code") code: string) {
    const entry = this.pairing.peek(code);
    if (!entry) {
      throw new NotFoundException("Kod yaroqsiz yoki muddati o'tgan");
    }
    return {
      provider: entry.provider,
      expiresAt: new Date(entry.expiresAt).toISOString(),
      portalUrl: LOCAL_CONNECTOR_PORTALS[entry.provider],
    };
  }

  @Post("capture")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async capture(@Body() dto: LocalConnectorCaptureDto, @Req() request: Request) {
    const entry = this.pairing.consume(dto.code);
    if (!entry) {
      throw new BadRequestException(
        "Kod yaroqsiz yoki muddati o'tgan. Saytdan yangi kod oling.",
      );
    }

    const clientIp = ip(request);
    const result = await this.external.saveConnection(
      entry.actor,
      entry.provider,
      {
        token: dto.token.trim(),
        refreshToken: dto.refreshToken,
        config: { authMethod: "BROWSER" },
        profiles: dto.profiles,
      },
      clientIp,
    );

    void this.external
      .syncConnection(entry.actor.tenantId, entry.provider, entry.actor.userId, clientIp)
      .catch(() => undefined);

    return {
      success: true,
      provider: entry.provider,
      account: result.account,
    };
  }
}
