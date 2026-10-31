import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import type { Request } from "express";
import { CurrentUser, Roles } from "../../common/auth/decorators";
import type { AuthenticatedUser } from "../../common/auth/auth.types";
import { SubmissionsService } from "./submissions.service";
import {
  ApproveSubmissionDto,
  RejectSubmissionDto,
  UpdateCompanyPaymentDetailsDto,
} from "./dto/submission.dto";

@ApiTags("submissions")
@ApiBearerAuth()
@Controller("submissions")
export class SubmissionsController {
  constructor(private readonly submissions: SubmissionsService) {}

  @Get("company-payment-info")
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.ACCOUNTANT)
  getCompanyPaymentInfo(@CurrentUser() user: AuthenticatedUser) {
    return this.submissions.getPaymentInfo(user.tenantId);
  }

  @Put("company-payment-info")
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  updateCompanyPaymentInfo(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateCompanyPaymentDetailsDto,
    @Req() req: Request,
  ) {
    return this.submissions.updatePaymentInfo(user, dto, req.ip ?? null);
  }

  @Get()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.ACCOUNTANT)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query("status") status?: string,
    @Query("driverId") driverId?: string,
    @Query("risk") risk?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.submissions.listSubmissions(user.tenantId, {
      status,
      driverId,
      risk,
      page,
      limit,
    });
  }

  @Post(":id/approve")
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.ACCOUNTANT)
  @HttpCode(200)
  approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ApproveSubmissionDto,
    @Req() req: Request,
  ) {
    return this.submissions.approveSubmission(user, id, dto, req.ip ?? null);
  }

  @Post(":id/reject")
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.ACCOUNTANT)
  @HttpCode(200)
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: RejectSubmissionDto,
    @Req() req: Request,
  ) {
    return this.submissions.rejectSubmission(user, id, dto, req.ip ?? null);
  }
}

