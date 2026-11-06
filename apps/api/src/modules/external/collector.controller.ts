import {
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser, Roles } from "../../common/auth/decorators";
import type { AuthenticatedUser } from "../../common/auth/auth.types";
import { CollectorService } from "./collector.service";

@ApiTags("collector")
@ApiBearerAuth()
@Roles("OWNER", "ADMIN")
@Controller("collector")
export class CollectorController {
  constructor(private readonly collector: CollectorService) {}

  private assertSuperAdmin(actor: AuthenticatedUser): void {
    if (!actor.isSuperAdmin) {
      throw new ForbiddenException("Bu bo'lim faqat super admin uchun");
    }
  }

  @Get("status")
  async getStatus(@CurrentUser() actor: AuthenticatedUser) {
    this.assertSuperAdmin(actor);
    return this.collector.getStatus();
  }

  @Get("summary")
  async getSummary(@CurrentUser() actor: AuthenticatedUser) {
    this.assertSuperAdmin(actor);
    return this.collector.getSummary();
  }

  @Get("records")
  async getRecords(
    @CurrentUser() actor: AuthenticatedUser,
    @Query("source") source?: string,
    @Query("record_type") record_type?: string,
    @Query("search") search?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    this.assertSuperAdmin(actor);
    return this.collector.getRecords({
      source,
      record_type,
      search,
      page: page ? parseInt(page, 10) : 1,
      pageSize: pageSize ? parseInt(pageSize, 10) : 50,
    });
  }

  @Get("records/:id")
  async getRecordDetail(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id", ParseIntPipe) id: number,
  ) {
    this.assertSuperAdmin(actor);
    const record = await this.collector.getRecordDetail(id);
    if (!record) throw new NotFoundException("Kollektor yozuvi topilmadi");
    return record;
  }

  @Post("sync")
  async triggerSync(@CurrentUser() actor: AuthenticatedUser) {
    this.assertSuperAdmin(actor);
    return this.collector.triggerSync();
  }

  @Get("sync-status")
  async getSyncStatus(@CurrentUser() actor: AuthenticatedUser) {
    this.assertSuperAdmin(actor);
    return this.collector.getSyncStatus();
  }

  @Post("import")
  async importToTenant(@CurrentUser() user: AuthenticatedUser) {
    this.assertSuperAdmin(user);
    return this.collector.importToTenant(user.tenantId);
  }
}

