import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";
import { CurrentUser, Public } from "../../common/auth/decorators";
import type { AuthenticatedUser } from "../../common/auth/auth.types";
import { AuthService, type SessionMeta } from "./auth.service";
import {
  DisableTwoFactorDto,
  LoginDto,
  RefreshDto,
  TwoFactorCodeDto,
  VerifyTwoFactorDto,
} from "./dto/auth.dto";

function clientIp(request: Request): string | null {
  return request.ip ?? request.socket?.remoteAddress ?? null;
}

function meta(request: Request): SessionMeta {
  const userAgent = request.headers["user-agent"];
  return {
    ip: clientIp(request),
    userAgent: typeof userAgent === "string" ? userAgent : null,
  };
}

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post("login")
  login(@Body() dto: LoginDto, @Req() request: Request) {
    return this.auth.login(dto, meta(request));
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post("2fa/verify")
  verifyTwoFactor(@Body() dto: VerifyTwoFactorDto, @Req() request: Request) {
    return this.auth.verifyTwoFactor(dto, meta(request));
  }

  @ApiBearerAuth()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("2fa/setup")
  setupTwoFactor(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.auth.setupTwoFactor(user.tenantId, user.userId, clientIp(request));
  }

  @ApiBearerAuth()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post("2fa/enable")
  enableTwoFactor(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: TwoFactorCodeDto,
    @Req() request: Request,
  ) {
    return this.auth.enableTwoFactor(
      user.tenantId,
      user.userId,
      dto.code,
      clientIp(request),
    );
  }

  @ApiBearerAuth()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post("2fa/disable")
  disableTwoFactor(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: DisableTwoFactorDto,
    @Req() request: Request,
  ) {
    return this.auth.disableTwoFactor(
      user.tenantId,
      user.userId,
      dto,
      clientIp(request),
    );
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(200)
  @Post("refresh")
  refresh(@Body() dto: RefreshDto, @Req() request: Request) {
    return this.auth.refresh(dto, meta(request));
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(204)
  @Post("logout")
  async logout(@Body() dto: RefreshDto, @Req() request: Request): Promise<void> {
    await this.auth.logout(dto.refreshToken, clientIp(request));
  }

  @ApiBearerAuth()
  @Get("me")
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.me(user.tenantId, user.userId);
  }

  @ApiBearerAuth()
  @Get("sessions")
  sessions(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.listSessions(user.tenantId, user.userId, user.sessionId);
  }

  @ApiBearerAuth()
  @HttpCode(200)
  @Post("sessions/revoke-others")
  revokeOtherSessions(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.auth.revokeOtherSessions(
      user.tenantId,
      user.userId,
      user.sessionId,
      clientIp(request),
    );
  }

  @ApiBearerAuth()
  @Delete("sessions/:id")
  revokeSession(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Req() request: Request,
  ) {
    return this.auth.revokeSession(
      user.tenantId,
      user.userId,
      id,
      clientIp(request),
    );
  }
}
