import { Injectable, Logger } from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { TenantPrismaService, type TenantTx } from "../../common/prisma/tenant-prisma.service";
import { MetricsService } from "../../common/metrics/metrics.module";
import { NotificationsQueueService } from "./notifications.queue";
import {
  TelegramNotifier,
  escapeTelegramHtml,
  formatMoney,
} from "./telegram.notifier";
import {
  notificationEventSchema,
  type NotificationEvent,
} from "./notifications.types";

const FINANCE_ROLES: UserRole[] = [
  UserRole.OWNER,
  UserRole.ADMIN,
  UserRole.ACCOUNTANT,
];

interface BuiltMessage {
  text: string;
  ownerUserId: string | null;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly notifier: TelegramNotifier,
    private readonly queue: NotificationsQueueService,
    private readonly metrics: MetricsService,
  ) {}

  async dispatch(raw: unknown, jobId: string | null): Promise<{
    status: string;
    recipients: number;
    sent: number;
    failed: number;
  }> {
    const event = notificationEventSchema.parse(raw);

    if (!this.notifier.enabled) {
      await this.writeLog(event, jobId, "SKIPPED", 0, 0, 0, "BOT_TOKEN yo'q");
      return { status: "SKIPPED", recipients: 0, sent: 0, failed: 0 };
    }

    const built = await this.tenantPrisma.withTenant(event.tenantId, (tx) =>
      this.buildMessage(tx, event),
    );

    const recipients = await this.tenantPrisma.withTenant(
      event.tenantId,
      async (tx) => {
        const accounts = await tx.telegramAccount.findMany({
          where: {
            user: {
              is: {
                isActive: true,
                OR: [
                  { role: { in: FINANCE_ROLES } },
                  ...(built.ownerUserId ? [{ id: built.ownerUserId }] : []),
                ],
              },
            },
          },
          select: { chatId: true, user: { select: { fullName: true } } },
          take: 100,
        });
        return accounts;
      },
    );

    if (recipients.length === 0) {
      await this.writeLog(event, jobId, "SKIPPED", 0, 0, 0, "Bog'langan foydalanuvchi yo'q");
      return { status: "SKIPPED", recipients: 0, sent: 0, failed: 0 };
    }

    let sent = 0;
    let failed = 0;
    let lastError: string | null = null;
    for (const account of recipients) {
      try {
        await this.notifier.send(account.chatId.toString(), built.text);
        sent += 1;
      } catch (error) {
        failed += 1;
        lastError = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Telegram xabar yuborilmadi tenant=${event.tenantId} chat=${account.chatId}: ${lastError}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    const status = failed === 0 ? "SENT" : sent > 0 ? "PARTIAL" : "FAILED";
    await this.writeLog(event, jobId, status, recipients.length, sent, failed, lastError);
    this.metrics.notificationDispatches.inc({ event: event.type, status });
    return { status, recipients: recipients.length, sent, failed };
  }

  private async buildMessage(tx: TenantTx, event: NotificationEvent): Promise<BuiltMessage> {
    const company = await tx.company.findUniqueOrThrow({
      where: { id: event.tenantId },
      select: { name: true },
    });
    const header = `<b>${escapeTelegramHtml(company.name)}</b>`;

    if (event.type === "system.test") {
      return {
        text: `${header}\n\n${escapeTelegramHtml(event.data.text ?? "Staging bildirishnoma testi")}`,
        ownerUserId: null,
      };
    }

    if (event.type.startsWith("payment.")) {
      if (!event.data.paymentId) throw new Error("paymentId yo'q");
      const payment = await tx.payment.findFirstOrThrow({
        where: { id: event.data.paymentId },
        include: {
          contract: {
            select: {
              ownerId: true,
              owner: { select: { fullName: true } },
              vehicle: { select: { plateNumber: true, model: true } },
            },
          },
        },
      });
      const title =
        event.type === "payment.paid"
          ? "To'lov qabul qilindi"
          : event.type === "payment.refunded"
            ? "To'lov qaytarildi"
            : "To'lov amalga oshmadi";
      return {
        text: [
          header,
          `<b>${title}</b>`,
          `${escapeTelegramHtml(payment.contract.vehicle.plateNumber)} · ${escapeTelegramHtml(payment.contract.vehicle.model)}`,
          `Ega: ${escapeTelegramHtml(payment.contract.owner.fullName)}`,
          `Summa: <b>${formatMoney(payment.amount.toFixed(2))}</b>`,
          payment.description ? escapeTelegramHtml(payment.description.slice(0, 200)) : "",
          `Sana: ${new Date(event.occurredAt).toLocaleString("uz-UZ")}`,
        ]
          .filter(Boolean)
          .join("\n"),
        ownerUserId: payment.contract.ownerId,
      };
    }

    if (
      event.type === "subscription.invoice_issued" ||
      event.type === "subscription.invoice_overdue"
    ) {
      if (!event.data.invoiceId) throw new Error("invoiceId yo'q");
      const invoice = await tx.subscriptionInvoice.findFirstOrThrow({
        where: { id: event.data.invoiceId },
        include: { subscription: { include: { plan: { select: { name: true } } } } },
      });
      const title =
        event.type === "subscription.invoice_issued"
          ? "Yangi obuna hisobi"
          : "Obuna hisobi muddati o'tdi";
      return {
        text: [
          header,
          `<b>${title}</b>`,
          `Hisob: ${escapeTelegramHtml(invoice.number)}`,
          `Reja: ${escapeTelegramHtml(invoice.subscription.plan.name)}`,
          `Summa: <b>${formatMoney(invoice.amount.toFixed(2))}</b>`,
          `To'lov muddati: ${invoice.dueDate.toISOString().slice(0, 10)}`,
        ].join("\n"),
        ownerUserId: null,
      };
    }

    if (event.type === "subscription.trial_ending") {
      if (!event.data.subscriptionId) throw new Error("subscriptionId yo'q");
      const subscription = await tx.subscription.findFirstOrThrow({
        where: { id: event.data.subscriptionId },
        include: { plan: { select: { name: true } } },
      });
      return {
        text: [
          header,
          `<b>Sinov muddati tugamoqda</b>`,
          `Reja: ${escapeTelegramHtml(subscription.plan.name)}`,
          `Tugash sanasi: ${subscription.currentPeriodEnd?.toISOString().slice(0, 10) ?? "noma'lum"}`,
          "Obunani davom ettirish uchun web paneldagi Obuna bo'limiga o'ting.",
        ].join("\n"),
        ownerUserId: null,
      };
    }

    return {
      text: [
        header,
        `<b>Obuna rejasi o'zgartirildi</b>`,
        `Yangi reja: ${escapeTelegramHtml(event.data.planName ?? "noma'lum")}`,
        "Tafsilotlar web paneldagi Obuna bo'limida.",
      ].join("\n"),
      ownerUserId: null,
    };
  }

  private async writeLog(
    event: NotificationEvent,
    jobId: string | null,
    status: string,
    recipients: number,
    sent: number,
    failed: number,
    error: string | null,
  ): Promise<void> {
    try {
      await this.tenantPrisma.withTenant(event.tenantId, (tx) =>
        tx.notificationLog.create({
          data: {
            tenantId: event.tenantId,
            event: event.type,
            jobId,
            recipients,
            sent,
            failed,
            status,
            error: error?.slice(0, 500) ?? null,
            payload: event.data,
          },
        }),
      );
    } catch (logError) {
      this.logger.warn(
        `NotificationLog yozilmadi: ${
          logError instanceof Error ? logError.message : String(logError)
        }`,
      );
    }
  }

  async list(tenantId: string) {
    return this.tenantPrisma.withTenant(tenantId, async (tx) => ({
      items: await tx.notificationLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
    }));
  }
}
