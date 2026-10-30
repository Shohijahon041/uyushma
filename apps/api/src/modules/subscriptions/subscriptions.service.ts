import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { InvoiceStatus } from "@prisma/client";
import { TenantPrismaService } from "../../common/prisma/tenant-prisma.service";
import { AuditService } from "../audit/audit.service";
import type { AuthenticatedUser } from "../../common/auth/auth.types";
import { ChangePlanDto } from "./dto/subscription.dto";
import { NotificationsQueueService } from "../notifications/notifications.queue";

function monthPeriod(reference: Date): { start: Date; end: Date } {
  const start = new Date(
    Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), 1),
  );
  const end = new Date(
    Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth() + 1, 0),
  );
  return { start, end };
}

function monthLabel(date: Date): string {
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setUTCMonth(result.getUTCMonth() + months);
  return result;
}

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsQueueService,
  ) {}

  async current(tenantId: string) {
    return this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const subscription = await tx.subscription.findFirst({
        where: { status: { in: ["TRIAL", "ACTIVE", "PAST_DUE"] } },
        include: {
          plan: true,
          invoices: { orderBy: { createdAt: "desc" }, take: 12 },
        },
      });
      if (!subscription) return { subscription: null };
      return {
        subscription: {
          ...subscription,
          plan: {
            ...subscription.plan,
            monthlyPrice: subscription.plan.monthlyPrice.toFixed(2),
          },
          invoices: subscription.invoices.map((invoice) => ({
            ...invoice,
            amount: invoice.amount.toFixed(2),
          })),
        },
      };
    });
  }

  async listPlans(tenantId: string) {
    return this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const plans = await tx.plan.findMany({
        where: { isActive: true },
        orderBy: { monthlyPrice: "asc" },
      });
      return {
        items: plans.map((plan) => ({
          ...plan,
          monthlyPrice: plan.monthlyPrice.toFixed(2),
        })),
      };
    });
  }

  async changePlan(
    actor: AuthenticatedUser,
    dto: ChangePlanDto,
    ip: string | null,
  ) {
    const result = await this.tenantPrisma.withTenant(actor.tenantId, async (tx) => {
      const plan = await tx.plan.findFirst({
        where: { id: dto.planId, isActive: true },
      });
      if (!plan) throw new NotFoundException("Obuna rejasi topilmadi");

      const subscription = await tx.subscription.findFirst({
        where: { status: { in: ["TRIAL", "ACTIVE", "PAST_DUE"] } },
      });
      if (!subscription) throw new NotFoundException("Faol obuna topilmadi");

      const [activeUsers, activeVehicles] = await Promise.all([
        tx.user.count({ where: { isActive: true } }),
        // Mirrored provider vehicles are excluded from the plan quota.
        tx.vehicle.count({
          where: { status: { not: "INACTIVE" }, externalVehicles: { none: {} } },
        }),
      ]);
      if (activeUsers > plan.maxUsers) {
        throw new ForbiddenException(
          `Bu rejada ${plan.maxUsers} foydalanuvchi limiti bor, hozir ${activeUsers} faol`,
        );
      }
      if (activeVehicles > plan.maxVehicles) {
        throw new ForbiddenException(
          `Bu rejada ${plan.maxVehicles} avtomobil limiti bor, hozir ${activeVehicles} ta`,
        );
      }

      const today = new Date();
      const periodEnd = addMonths(today, 1);
      const updated = await tx.subscription.update({
        where: { id: subscription.id },
        data: {
          planId: plan.id,
          status: subscription.status === "TRIAL" ? "TRIAL" : "ACTIVE",
          currentPeriodEnd: periodEnd,
          cancelAtPeriodEnd: false,
        },
        include: { plan: true },
      });
      await this.audit.record(tx, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: "subscription.plan_changed",
        entityType: "Subscription",
        entityId: subscription.id,
        metadata: { from: subscription.planId, to: plan.id },
        ip,
      });
      return {
        subscription: {
          ...updated,
          plan: {
            ...updated.plan,
            monthlyPrice: updated.plan.monthlyPrice.toFixed(2),
          },
        },
      };
    });

    await this.notifications.enqueue({
      tenantId: actor.tenantId,
      type: "subscription.plan_changed",
      dedupeKey: `plan_change__${result.subscription.id}__${Date.now()}`,
      occurredAt: new Date().toISOString(),
      data: { planName: result.subscription.plan.name },
    });
    return result;
  }

  /**
   * Idempotent per subscription and calendar month: the unique
   * (subscriptionId, periodStart) index guarantees no duplicate invoice.
   */
  async generateInvoiceForTenant(
    tenantId: string,
    actor: { userId?: string } | null,
    ip: string | null = null,
  ): Promise<{
    created: boolean;
    invoiceId?: string;
    number?: string;
    reason?: string;
  }> {
    const result = await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const subscription = await tx.subscription.findFirst({
        where: { status: { in: ["TRIAL", "ACTIVE", "PAST_DUE"] } },
        include: { plan: true },
      });
      if (!subscription) return { created: false, reason: "no_active_subscription" };

      const now = new Date();
      // TRIAL invoices are issued only after trial expiry.
      if (
        subscription.status === "TRIAL" &&
        subscription.currentPeriodEnd &&
        subscription.currentPeriodEnd > now
      ) {
        return { created: false, reason: "trial_not_expired" };
      }

      const { start, end } = monthPeriod(now);
      const existing = await tx.subscriptionInvoice.findUnique({
        where: {
          subscriptionId_periodStart: {
            subscriptionId: subscription.id,
            periodStart: start,
          },
        },
      });
      if (existing) {
        return {
          created: false,
          invoiceId: existing.id,
          number: existing.number,
          reason: "already_issued",
        };
      }

      const number = `SAAS-${monthLabel(now)}-${tenantId.slice(0, 8).toUpperCase()}`;
      const dueDate = new Date(start);
      dueDate.setUTCDate(dueDate.getUTCDate() + 14);

      const invoice = await tx.subscriptionInvoice.create({
        data: {
          tenantId,
          subscriptionId: subscription.id,
          number,
          periodStart: start,
          periodEnd: end,
          amount: subscription.plan.monthlyPrice,
          dueDate,
          status: "OPEN",
        },
      });
      await this.audit.record(tx, {
        tenantId,
        actorUserId: actor?.userId ?? null,
        actorType: actor?.userId ? "USER" : "SYSTEM",
        action: "subscription.invoice_issued",
        entityType: "SubscriptionInvoice",
        entityId: invoice.id,
        metadata: {
          number: invoice.number,
          amount: invoice.amount.toFixed(2),
          periodStart: start.toISOString().slice(0, 10),
        },
        ip,
      });

      await tx.subscriptionInvoice.updateMany({
        where: {
          tenantId,
          status: InvoiceStatus.OPEN,
          dueDate: { lt: now },
          id: { not: invoice.id },
        },
        data: { status: InvoiceStatus.OVERDUE },
      });

      return { created: true, invoiceId: invoice.id, number: invoice.number };
    });

    if (result.created && result.invoiceId) {
      await this.notifications.enqueue({
        tenantId,
        type: "subscription.invoice_issued",
        dedupeKey: `invoice__${result.invoiceId}__issued`,
        occurredAt: new Date().toISOString(),
        data: {
          invoiceId: result.invoiceId,
          number: result.number,
        },
      });
    }
    return result;
  }

  /**
   * Daily reminder sweep: trial subscriptions ending within 3 days and
   * invoices past their due date. Idempotent via notification dedupe keys.
   */
  async runSubscriptionReminders(): Promise<{
    tenants: number;
    trialReminders: number;
    overdueReminders: number;
    failed: number;
  }> {
    const tenantIds = await this.tenantPrisma.listActiveTenantIds();
    const now = new Date();
    const horizon = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    let trialReminders = 0;
    let overdueReminders = 0;
    let failed = 0;

    for (const tenantId of tenantIds) {
      try {
        const outcome = await this.tenantPrisma.withTenant(tenantId, async (tx) => {
          const trial = await tx.subscription.findFirst({
            where: {
              status: "TRIAL",
              currentPeriodEnd: { gt: now, lte: horizon },
            },
            select: { id: true, currentPeriodEnd: true },
          });
          const overdue = await tx.subscriptionInvoice.findMany({
            where: { status: "OPEN", dueDate: { lt: now } },
            select: { id: true, number: true, dueDate: true },
          });
          if (overdue.length > 0) {
            await tx.subscriptionInvoice.updateMany({
              where: { id: { in: overdue.map((invoice) => invoice.id) } },
              data: { status: InvoiceStatus.OVERDUE },
            });
          }
          return { trial, overdue };
        });

        if (outcome.trial?.currentPeriodEnd) {
          const dateKey = outcome.trial.currentPeriodEnd.toISOString().slice(0, 10);
          await this.notifications.enqueue({
            tenantId,
            type: "subscription.trial_ending",
            dedupeKey: `trial__${outcome.trial.id}__${dateKey}`,
            occurredAt: now.toISOString(),
            data: { subscriptionId: outcome.trial.id, dueDate: dateKey },
          });
          trialReminders += 1;
        }
        for (const invoice of outcome.overdue) {
          await this.notifications.enqueue({
            tenantId,
            type: "subscription.invoice_overdue",
            dedupeKey: `invoice__${invoice.id}__overdue`,
            occurredAt: now.toISOString(),
            data: {
              invoiceId: invoice.id,
              number: invoice.number,
              dueDate: invoice.dueDate.toISOString().slice(0, 10),
            },
          });
          overdueReminders += 1;
        }
      } catch (error) {
        failed += 1;
        this.logger.error(
          `Reminders failed for tenant ${tenantId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return {
      tenants: tenantIds.length,
      trialReminders,
      overdueReminders,
      failed,
    };
  }

  async generateInvoice(
    actor: AuthenticatedUser,
    ip: string | null,
  ) {
    const result = await this.generateInvoiceForTenant(actor.tenantId, actor, ip);
    if (!result.created) {
      if (result.reason === "no_active_subscription") {
        throw new NotFoundException("Faol obuna topilmadi");
      }
      if (result.reason === "trial_not_expired") {
        throw new BadRequestException("Sinov muddati hali tugamagan");
      }
    }
    return result;
  }

  async listInvoices(tenantId: string) {
    return this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const invoices = await tx.subscriptionInvoice.findMany({
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      return {
        items: invoices.map((invoice) => ({
          ...invoice,
          amount: invoice.amount.toFixed(2),
        })),
      };
    });
  }

  async runBillingForAllTenants(): Promise<{
    tenants: number;
    created: number;
    skipped: number;
    failed: number;
    results: Array<{ tenantId: string; status: string }>;
  }> {
    const tenantIds = await this.tenantPrisma.listActiveTenantIds();
    let created = 0;
    let skipped = 0;
    let failed = 0;
    const results: Array<{ tenantId: string; status: string }> = [];

    for (const tenantId of tenantIds) {
      try {
        const result = await this.generateInvoiceForTenant(tenantId, null);
        if (result.created) created += 1;
        else skipped += 1;
        results.push({
          tenantId,
          status: result.created ? "created" : result.reason ?? "skipped",
        });
      } catch (error) {
        failed += 1;
        this.logger.error(
          `Billing failed for tenant ${tenantId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        results.push({ tenantId, status: "failed" });
      }
    }

    return { tenants: tenantIds.length, created, skipped, failed, results };
  }
}
