import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import type { Request } from "express";
import { CurrentUser, Roles } from "../../common/auth/decorators";
import type { AuthenticatedUser } from "../../common/auth/auth.types";
import { DocumentsService } from "./documents.service";
import { CreateUploadDto } from "./dto/document.dto";

function ip(request: Request): string | null {
  return request.ip ?? request.socket?.remoteAddress ?? null;
}

@ApiTags("documents")
@ApiBearerAuth()
@Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.ACCOUNTANT)
@Controller("documents")
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query("contractId") contractId?: string,
  ) {
    return this.documents.list(user.tenantId, contractId);
  }

  @Post("upload-url")
  createUpload(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateUploadDto,
    @Req() request: Request,
  ) {
    return this.documents.createUpload(user, dto, ip(request));
  }

  @Post(":id/confirm")
  confirm(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Req() request: Request,
  ) {
    return this.documents.confirm(user, id, ip(request));
  }

  @Get(":id/download-url")
  download(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    return this.documents.downloadUrl(user, id);
  }
}
