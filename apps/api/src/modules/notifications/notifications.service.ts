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
  driverText?: string;
  driverChatId?: string | null;
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

    const recipientMessages: Array<{ chatId: string; text: string }> = [];

    // 1. Kompaniya xodimlari (moliya va egalari)
    const staffAccounts = await this.tenantPrisma.withTenant(
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
          select: { chatId: true },
          take: 100,
        });
        return accounts;
      },
    );

    for (const acc of staffAccounts) {
      recipientMessages.push({
        chatId: acc.chatId.toString(),
        text: built.text,
      });
    }

    // 2. Agar haydovchiga mo'ljallangan bo'lsa va uning Telegram chati mavjud bo'lsa
    if (built.driverChatId) {
      const driverMsg = built.driverText ?? built.text;
      const alreadyIncluded = recipientMessages.some(
        (r) => r.chatId === built.driverChatId,
      );
      if (!alreadyIncluded) {
        recipientMessages.push({
          chatId: built.driverChatId,
          text: driverMsg,
        });
      }
    }

    if (recipientMessages.length === 0) {
      await this.writeLog(
        event,
        jobId,
        "SKIPPED",
        0,
        0,
        0,
        "Bog'langan foydalanuvchi yoki haydovchi topilmadi",
      );
      return { status: "SKIPPED", recipients: 0, sent: 0, failed: 0 };
    }

    let sent = 0;
    let failed = 0;
    let lastError: string | null = null;
    for (const item of recipientMessages) {
      try {
        await this.notifier.send(item.chatId, item.text);
        sent += 1;
      } catch (error) {
        failed += 1;
        lastError = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Telegram xabar yuborilmadi tenant=${event.tenantId} chat=${item.chatId}: ${lastError}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    const status = failed === 0 ? "SENT" : sent > 0 ? "PARTIAL" : "FAILED";
    await this.writeLog(
      event,
      jobId,
      status,
      recipientMessages.length,
      sent,
      failed,
      lastError,
    );
    this.metrics.notificationDispatches.inc({ event: event.type, status });
    return { status, recipients: recipientMessages.length, sent, failed };
  }

  private async buildMessage(
    tx: TenantTx,
    event: NotificationEvent,
  ): Promise<BuiltMessage> {
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

    // -----------------------------------------------------------------------
    // Haydovchi to'lovi qabul qilinganda
    // -----------------------------------------------------------------------
    if (event.type === "driver.payment_received") {
      let driverChatId: string | null = null;
      let driverFullName = event.data.driverName ?? "Haydovchi";
      let plate = event.data.plateNumber ?? "";

      if (event.data.driverId) {
        const driver = await tx.driver.findFirst({
          where: { id: event.data.driverId },
          select: { telegramChatId: true, fullName: true },
        });
        if (driver) {
          driverFullName = driver.fullName;
          if (driver.telegramChatId) {
            driverChatId = driver.telegramChatId.toString();
          }
        }
      }

      const amountFormatted = event.data.amount
        ? formatMoney(event.data.amount)
        : "";
      const methodLabel =
        event.data.method === "CARD" ? "Plastik karta" : "Naqd pul";

      // Xodimlar uchun xabarnoma
      const staffText = [
        header,
        "💵 <b>Haydovchi to'lovi qabul qilindi</b>",
        `Haydovchi: <b>${escapeTelegramHtml(driverFullName)}</b>`,
        plate ? `Avtomobil: <b>${escapeTelegramHtml(plate)}</b>` : "",
        `Summa: <b>${amountFormatted}</b> (${methodLabel})`,
        event.data.paidMonth ? `Davr: ${event.data.paidMonth}` : "",
        event.data.receivedByName
          ? `Qabul qildi: ${escapeTelegramHtml(event.data.receivedByName)}`
          : "",
        `Sana: ${new Date(event.occurredAt).toLocaleString("uz-UZ")}`,
      ]
        .filter(Boolean)
        .join("\n");

      // Haydovchi uchun shaxsiy kvitansiya
      const driverText = [
        header,
        "✅ <b>To'lovingiz muvaffaqiyatli qabul qilindi!</b>",
        plate ? `Avtomobil: <b>${escapeTelegramHtml(plate)}</b>` : "",
        `To'langan summa: <b>${amountFormatted}</b> (${methodLabel})`,
        event.data.paidMonth ? `Davr: ${event.data.paidMonth}` : "",
        event.data.paidTotal
          ? `Ushbu oyda jami to'landi: ${formatMoney(event.data.paidTotal)}`
          : "",
        event.data.debtAmount
          ? `Qoldiq qarzdorlik: <b>${formatMoney(event.data.debtAmount)}</b>`
          : "",
        `To'lov vaqti: ${new Date(event.occurredAt).toLocaleString("uz-UZ")}`,
        "\n<i>Rahmat, yo'lingiz bexatar bo'lsin!</i>",
      ]
        .filter(Boolean)
        .join("\n");

      return {
        text: staffText,
        driverText,
        driverChatId,
        ownerUserId: null,
      };
    }

    // -----------------------------------------------------------------------
    // Haydovchiga qarzdorlik eslatmasi
    // -----------------------------------------------------------------------
    if (event.type === "driver.debt_reminder") {
      let driverChatId: string | null = null;
      let driverFullName = event.data.driverName ?? "Haydovchi";

      if (event.data.driverId) {
        const driver = await tx.driver.findFirst({
          where: { id: event.data.driverId },
          select: { telegramChatId: true, fullName: true },
        });
        if (driver) {
          driverFullName = driver.fullName;
          if (driver.telegramChatId) {
            driverChatId = driver.telegramChatId.toString();
          }
        }
      }

      const debtFormatted = event.data.debtAmount
        ? formatMoney(event.data.debtAmount)
        : "0 so'm";
      const planFormatted = event.data.planAmount
        ? formatMoney(event.data.planAmount)
        : "";

      const text = [
        header,
        "⚠️ <b>Kunlik to'lov eslatmasi</b>",
        `Hurmatli <b>${escapeTelegramHtml(driverFullName)}</b>,`,
        event.data.plateNumber
          ? `Avtomobil: <b>${escapeTelegramHtml(event.data.plateNumber)}</b>`
          : "",
        event.data.paidMonth ? `Davr: ${event.data.paidMonth}` : "",
        planFormatted ? `Oylik reja: ${planFormatted}` : "",
        `<b>Joriy qarzdorlik: ${debtFormatted}</b>`,
        "\nIltimos, to'lovni o'z vaqtida amalga oshirishingizni so'raymiz.",
      ]
        .filter(Boolean)
        .join("\n");

      return {
        text,
        driverText: text,
        driverChatId,
        ownerUserId: null,
      };
    }

    // -----------------------------------------------------------------------
    // Litsenziya / Guvohnoma muddati tugashi
    // -----------------------------------------------------------------------
    if (event.type === "vehicle.license_expiring") {
      const plate = event.data.plateNumber ?? "";
      const model = event.data.model ?? "";
      const license = event.data.licenseNumber ?? "Noma'lum";
      const days = event.data.daysLeft ?? 0;
      const expires = event.data.expiresAt ?? "";

      const text = [
        header,
        "⚠️ <b>Litsenziya kartasi muddati tugamoqda!</b>",
        `Avtomobil: <b>${escapeTelegramHtml(plate)}</b> ${model ? `· ${escapeTelegramHtml(model)}` : ""}`,
        `Litsenziya raqami: <code>${escapeTelegramHtml(license)}</code>`,
        `Amal qilish muddati: <b>${expires}</b>`,
        `Qolgan vaqt: <b>${days} kun</b>`,
        "\nIltimos, tender/litsenziya hujjatlarini o'z vaqtida yangilang.",
      ].join("\n");

      return {
        text,
        ownerUserId: null,
      };
    }

    // -----------------------------------------------------------------------
    // Transport shartnoma to'lovi (Payments)
    // -----------------------------------------------------------------------
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

  /**
   * Worker yoki avtomatlashtirilgan cron tomonidan chaqiriladi:
   * 1. Qarzdor haydovchilarga kunlik eslatma
   * 2. Litsenziyasi tugashiga <= 15 kun qolgan avtomobillar bo'yicha ogohlantirish
   */
  async runRemindersForAllTenants(): Promise<{
    tenants: number;
    debtRemindersEnqueued: number;
    licenseAlertsEnqueued: number;
  }> {
    const tenantIds = await this.tenantPrisma.listActiveTenantIds();

    let totalDebtReminders = 0;
    let totalLicenseAlerts = 0;
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const periodStart = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
    const fifteenDaysLater = new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000);

    for (const tenantId of tenantIds) {
      try {
        await this.tenantPrisma.withTenant(tenantId, async (tx) => {
          // 1. Qarzdorlik eslatmalari
          const plans = await tx.vehicleMonthlyPlan.findMany({
            where: { periodStart },
            include: {
              driver: {
                select: { id: true, fullName: true, telegramChatId: true },
              },
              vehicle: {
                select: { id: true, plateNumber: true, model: true },
              },
            },
          });

          for (const plan of plans) {
            const paidAgg = await tx.driverPayment.aggregate({
              where: {
                vehicleId: plan.vehicleId,
                periodStart,
              },
              _sum: { amount: true },
            });
            const paid = paidAgg._sum.amount ?? 0;
            const debt = Number(plan.amount) - Number(paid);

            if (debt > 0) {
              await this.queue.enqueue({
                tenantId,
                type: "driver.debt_reminder",
                dedupeKey: `debt_${plan.id}_${todayStr}`,
                occurredAt: now.toISOString(),
                data: {
                  driverId: plan.driverId,
                  driverName: plan.driver.fullName,
                  vehicleId: plan.vehicleId,
                  plateNumber: plan.vehicle.plateNumber,
                  paidMonth: todayStr.slice(0, 7),
                  planAmount: Number(plan.amount).toFixed(2),
                  debtAmount: debt.toFixed(2),
                },
              });
              totalDebtReminders += 1;
            }
          }

          // 2. Litsenziya muddatlari (ExternalVehicle)
          const expiringVehicles = await tx.externalVehicle.findMany({
            where: {
              licenseExpiresAt: {
                gte: now,
                lte: fifteenDaysLater,
              },
            },
            select: {
              id: true,
              plateNumber: true,
              vehicleModel: true,
              licenseNumber: true,
              licenseExpiresAt: true,
            },
            take: 20,
          });

          for (const ev of expiringVehicles) {
            if (!ev.licenseExpiresAt) continue;
            const diffDays = Math.max(
              0,
              Math.ceil(
                (ev.licenseExpiresAt.getTime() - now.getTime()) /
                  (24 * 60 * 60 * 1000),
              ),
            );
            await this.queue.enqueue({
              tenantId,
              type: "vehicle.license_expiring",
              dedupeKey: `lic_${ev.id}_${todayStr}`,
              occurredAt: now.toISOString(),
              data: {
                plateNumber: ev.plateNumber ?? undefined,
                model: ev.vehicleModel ?? undefined,
                licenseNumber: ev.licenseNumber ?? undefined,
                expiresAt: ev.licenseExpiresAt.toISOString().slice(0, 10),
                daysLeft: diffDays,
              },
            });
            totalLicenseAlerts += 1;
          }
        });
      } catch (companyError) {
        this.logger.error(
          `Tenant=${tenantId} eslatmalarni tekshirishda xato: ${
            companyError instanceof Error
              ? companyError.message
              : String(companyError)
          }`,
        );
      }
    }

    return {
      tenants: tenantIds.length,
      debtRemindersEnqueued: totalDebtReminders,
      licenseAlertsEnqueued: totalLicenseAlerts,
    };
  }
}
