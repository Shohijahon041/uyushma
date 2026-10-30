import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../common/prisma/prisma.service";
import { TenantPrismaService } from "../../common/prisma/tenant-prisma.service";
import { AuditService } from "../audit/audit.service";
import type { AuthenticatedUser } from "../../common/auth/auth.types";

interface CompanyRow {
  id: string;
  slug: string;
  name: string;
  status: string;
  created_at: Date;
  user_count: number;
  vehicle_count: number;
  driver_count: number;
  payment_count: number;
  collected_total: Prisma.Decimal;
  plan_id: string | null;
  subscription_status: string | null;
  period_end: Date | null;
  last_sync_at: Date | null;
}

@Injectable()
export class PlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  private assertSuperAdmin(actor: AuthenticatedUser): void {
    if (!actor.isSuperAdmin) {
      throw new ForbiddenException("Bu bo'lim faqat super admin uchun");
    }
  }

  async overview(actor: AuthenticatedUser) {
    this.assertSuperAdmin(actor);
    const rows = await this.prisma.$queryRaw<CompanyRow[]>`
      SELECT * FROM app_platform_companies()
    `;
    const companies = rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      status: row.status,
      createdAt: row.created_at,
      users: Number(row.user_count),
      vehicles: Number(row.vehicle_count),
      drivers: Number(row.driver_count),
      payments: Number(row.payment_count),
      collected: Number(row.collected_total ?? 0).toFixed(2),
      planId: row.plan_id,
      subscriptionStatus: row.subscription_status,
      periodEnd: row.period_end,
      lastSyncAt: row.last_sync_at,
    }));

    return {
      companies,
      totals: {
        companies: companies.length,
        active: companies.filter((company) => company.status === "ACTIVE").length,
        suspended: companies.filter((company) => company.status === "SUSPENDED").length,
        users: companies.reduce((total, company) => total + company.users, 0),
        vehicles: companies.reduce((total, company) => total + company.vehicles, 0),
        drivers: companies.reduce((total, company) => total + company.drivers, 0),
        payments: companies.reduce((total, company) => total + company.payments, 0),
        collected: companies
          .reduce((total, company) => total + Number(company.collected), 0)
          .toFixed(2),
      },
    };
  }

  async setCompanyStatus(
    actor: AuthenticatedUser,
    companyId: string,
    status: string,
    ip: string | null,
  ) {
    this.assertSuperAdmin(actor);
    if (status !== "ACTIVE" && status !== "SUSPENDED") {
      throw new BadRequestException("Holat faqat ACTIVE yoki SUSPENDED bo'ladi");
    }
    if (companyId === actor.tenantId && status === "SUSPENDED") {
      throw new BadRequestException("O'z kompaniyangizni to'xtatib bo'lmaydi");
    }
    const rows = await this.prisma.$queryRaw<Array<{ updated: boolean }>>`
      SELECT app_set_company_status(${companyId}::uuid, ${status}) AS updated
    `;
    if (!rows[0]?.updated) throw new NotFoundException("Kompaniya topilmadi");

    await this.tenantPrisma.withTenant(actor.tenantId, async (tx) => {
      await this.audit.record(tx, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: "platform.company_status_changed",
        entityType: "Company",
        entityId: companyId,
        metadata: { status },
        ip,
      });
    });
    return { updated: true, companyId, status };
  }
}
