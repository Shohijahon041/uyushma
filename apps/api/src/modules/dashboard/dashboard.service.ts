import { Injectable } from "@nestjs/common";
import { PaymentStatus } from "@prisma/client";
import { TenantPrismaService } from "../../common/prisma/tenant-prisma.service";

function startOfMonth(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

@Injectable()
export class DashboardService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  async summary(tenantId: string) {
    return this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const monthStart = startOfMonth();
      const now = new Date();
      const inThirtyDays = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      const [
        vehicles,
        activeContracts,
        routes,
        users,
        pendingAggregate,
        paidThisMonthAggregate,
        recentPayments,
        subscription,
        openSubscriptionInvoices,
        externalVehicles,
        externalApplications,
        externalContracts,
        externalCertificates,
        externalTenders,
        expiringCertificates,
        lastExternalSync,
      ] = await Promise.all([
        tx.vehicle.count({ where: { status: { not: "INACTIVE" } } }),
        tx.contract.count({ where: { status: "ACTIVE" } }),
        tx.route.count({ where: { isActive: true } }),
        tx.user.count({ where: { isActive: true } }),
        tx.payment.aggregate({
          where: { status: PaymentStatus.PENDING },
          _sum: { amount: true },
          _count: true,
        }),
        tx.payment.aggregate({
          where: { status: PaymentStatus.PAID, paidAt: { gte: monthStart } },
          _sum: { amount: true },
        }),
        tx.payment.findMany({
          orderBy: { createdAt: "desc" },
          take: 5,
          include: {
            contract: {
              select: {
                vehicle: { select: { plateNumber: true } },
                owner: { select: { fullName: true } },
              },
            },
          },
        }),
        tx.subscription.findFirst({
          where: { status: { in: ["TRIAL", "ACTIVE", "PAST_DUE"] } },
          include: { plan: true },
        }),
        tx.subscriptionInvoice.count({
          where: { status: { in: ["OPEN", "OVERDUE"] } },
        }),
        tx.externalVehicle.count(),
        tx.externalRecord.count({ where: { kind: "CONTRACT_APPLICATION" } }),
        tx.externalRecord.count({ where: { kind: "CONTRACT" } }),
        tx.externalRecord.count({ where: { kind: "CERTIFICATE" } }),
        tx.externalRecord.count({ where: { kind: "TENDER_APPLICATION" } }),
        tx.externalRecord.count({
          where: {
            kind: "CERTIFICATE",
            expiresAt: { gte: now, lte: inThirtyDays },
          },
        }),
        tx.externalConnection.findFirst({
          where: { lastSyncAt: { not: null } },
          orderBy: { lastSyncAt: "desc" },
          select: { lastSyncAt: true, provider: true },
        }),
      ]);

      return {
        counts: { vehicles, activeContracts, routes, users },
        external: {
          vehicles: externalVehicles,
          records: {
            CONTRACT_APPLICATION: externalApplications,
            CONTRACT: externalContracts,
            CERTIFICATE: externalCertificates,
            TENDER_APPLICATION: externalTenders,
          },
          expiringCertificates,
          lastSyncAt: lastExternalSync?.lastSyncAt ?? null,
          provider: lastExternalSync?.provider ?? null,
        },
        payments: {
          pendingAmount: pendingAggregate._sum.amount?.toFixed(2) ?? "0.00",
          pendingCount: pendingAggregate._count,
          paidThisMonth: paidThisMonthAggregate._sum.amount?.toFixed(2) ?? "0.00",
          recent: recentPayments.map((payment) => ({
            id: payment.id,
            amount: payment.amount.toFixed(2),
            status: payment.status,
            method: payment.method,
            createdAt: payment.createdAt,
            vehicle: payment.contract.vehicle.plateNumber,
            owner: payment.contract.owner.fullName,
          })),
        },
        subscription: subscription
          ? {
              status: subscription.status,
              planId: subscription.planId,
              planName: subscription.plan.name,
              currentPeriodEnd: subscription.currentPeriodEnd,
              monthlyFee: (subscription.monthlyFee ?? subscription.plan.monthlyPrice).toFixed(2),
              hasContract: subscription.monthlyFee !== null,
              openInvoices: openSubscriptionInvoices,
            }
          : null,
      };
    });
  }
}
