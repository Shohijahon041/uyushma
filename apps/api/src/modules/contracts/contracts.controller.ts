import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import type { Request } from "express";
import { CurrentUser, Roles } from "../../common/auth/decorators";
import type { AuthenticatedUser } from "../../common/auth/auth.types";
import { ContractsService } from "./contracts.service";
import { CreateContractDto, TerminateContractDto } from "./dto/contract.dto";

function ip(request: Request): string | null {
  return request.ip ?? request.socket?.remoteAddress ?? null;
}

@ApiTags("contracts")
@ApiBearerAuth()
@Controller("contracts")
export class ContractsController {
  constructor(private readonly contracts: ContractsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.contracts.list(user.tenantId);
  }

  @Post()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateContractDto,
    @Req() request: Request,
  ) {
    return this.contracts.create(user, dto, ip(request));
  }

  @Post(":id/activate")
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  activate(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Req() request: Request,
  ) {
    return this.contracts.activate(user, id, ip(request));
  }

  @Post(":id/terminate")
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  terminate(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: TerminateContractDto,
    @Req() request: Request,
  ) {
    return this.contracts.terminate(user, id, dto, ip(request));
  }
}
