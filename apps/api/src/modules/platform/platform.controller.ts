import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { IsIn } from "class-validator";
import type { Request } from "express";
import { CurrentUser } from "../../common/auth/decorators";
import type { AuthenticatedUser } from "../../common/auth/auth.types";
import { PlatformService } from "./platform.service";

class SetCompanyStatusDto {
  @IsIn(["ACTIVE", "SUSPENDED"])
  status!: "ACTIVE" | "SUSPENDED";
}

function ip(request: Request): string | null {
  return request.ip ?? request.socket?.remoteAddress ?? null;
}

@ApiTags("platform")
@ApiBearerAuth()
@Controller("platform")
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get("overview")
  overview(@CurrentUser() user: AuthenticatedUser) {
    return this.platform.overview(user);
  }

  @Post("companies/:id/status")
  setStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: SetCompanyStatusDto,
    @Req() request: Request,
  ) {
    return this.platform.setCompanyStatus(user, id, dto.status, ip(request));
  }
}
