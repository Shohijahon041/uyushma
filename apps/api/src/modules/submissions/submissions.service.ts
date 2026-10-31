import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { money } from "../../common/money/money";
import { TenantPrismaService } from "../../common/prisma/tenant-prisma.service";
import { AuditService } from "../audit/audit.service";
import { StorageService } from "../documents/storage.service";
import { NotificationsQueueService } from "../notifications/notifications.queue";
import { TelegramNotifier, formatMoney, escapeTelegramHtml } from "../notifications/telegram.notifier";
import { FraudDetectorService } from "./fraud-detector.service";
import {
  ApproveSubmissionDto,
  CreateSubmissionDto,
  RejectSubmissionDto,
  UpdateCompanyPaymentDetailsDto,
} from "./dto/submission.dto";
import type { AuthenticatedUser } from "../../common/auth/auth.types";
import { periodStartFor, formatPeriod, todayDateOnly, effectiveMonthlyFee } from "../drivers/billing";

@Injectable()
export class SubmissionsService {
  private readonly logger = new Logger(SubmissionsService.name);

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly fraudDetector: FraudDetectorService,
    private readonly notifications: NotificationsQueueService,
    private readonly telegramNotifier: TelegramNotifier,
  ) {}

  /**
   * Kompaniya to'lov kartasi va rekvizitlarini olish
   */
  async getPaymentInfo(tenantId: string) {
    return this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const company = await tx.company.findUniqueOrThrow({
        where: { id: tenantId },
        select: {
          id: true,
          name: true,
          paymentCardNumber: true,
          paymentCardHolder: true,
          paymentCardBank: true,
          paymentInstructions: true,
        },
      });
      return company;
    });
  }

  /**
   * Kompaniya to'lov kartasi rekvizitlarini yangilash (OWNER, ADMIN)
   */
  async updatePaymentInfo(
    actor: AuthenticatedUser,
    dto: UpdateCompanyPaymentDetailsDto,
    ip: string | null,
  ) {
    return this.tenantPrisma.withTenant(actor.tenantId, async (tx) => {
      const updated = await tx.company.update({
        where: { id: actor.tenantId },
        data: {
          paymentCardNumber: dto.paymentCardNumber?.trim() || null,
          paymentCardHolder: dto.paymentCardHolder?.trim() || null,
          paymentCardBank: dto.paymentCardBank?.trim() || null,
          paymentInstructions: dto.paymentInstructions?.trim() || null,
        },
        select: {
          id: true,
          name: true,
          paymentCardNumber: true,
          paymentCardHolder: true,
          paymentCardBank: true,
          paymentInstructions: true,
        },
      });

      await this.audit.record(tx, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: "company.payment_details_updated",
        entityType: "Company",
        entityId: actor.tenantId,
        metadata: {
          cardNumber: dto.paymentCardNumber ? "set" : "cleared",
        },
        ip,
      });

      return updated;
    });
  }

  /**
   * Haydovchi tomonidan chek topshirilishi (Bot yoki Web)
   */
  async createSubmission(
    tenantId: string,
    driverId: string,
    buffer: Buffer,
    filename: string,
    dto: {
      amount: string;
      vehicleId?: string;
      transactionNumber?: string;
      note?: string;
    },
  ) {
    const parsedAmount = money(dto.amount);
    if (parsedAmount.lte(0)) {
      throw new BadRequestException("To'lov summasi noldan katta bo'lishi kerak");
    }

    const now = new Date();
    const period = periodStartFor(now);
    const ext = filename.split(".").pop() || "jpg";
    const fileId = randomUUID();
    const fileKey = `submissions/${tenantId}/${fileId}.${ext}`;

    // S3/MinIO ga saqlash
    const mimeType = ext === "png" ? "image/png" : ext === "pdf" ? "application/pdf" : "image/jpeg";
    await this.storage.uploadBuffer(fileKey, buffer, mimeType);

    return this.tenantPrisma.withTenant(tenantId, async (tx) => {
      // Haydovchi va faol avtomobilni aniqlash
      let vehicleId = dto.vehicleId;
      if (!vehicleId) {
        const assignment = await tx.vehicleAssignment.findFirst({
          where: {
            driverId,
            startDate: { lte: todayDateOnly(now) },
            OR: [{ endDate: null }, { endDate: { gte: todayDateOnly(now) } }],
          },
          select: { vehicleId: true },
        });
        if (!assignment) {
          throw new BadRequestException(
            "Haydovchiga faol biriktirilgan avtomobil topilmadi. Avval avtomobil biriktiring.",
          );
        }
        vehicleId = assignment.vehicleId;
      }

      // 1. AI va soxtalik tekshiruvi (Fraud Detection)
      const fraudResult = await this.fraudDetector.analyzeReceipt(tx, buffer, {
        tenantId,
        driverId,
        amount: parsedAmount.toFixed(2),
        transactionNumber: dto.transactionNumber,
      });

      // 2. Arizani yaratish
      const created = await tx.paymentSubmission.create({
        data: {
          tenantId,
          driverId,
          vehicleId,
          amount: parsedAmount,
          periodStart: period,
          receiptFileKey: fileKey,
          transactionNumber: dto.transactionNumber?.trim() || null,
          imageHash: fraudResult.imageHash,
          status: "PENDING",
          fraudRisk: fraudResult.risk,
          fraudScore: fraudResult.score,
          fraudFlags: fraudResult.flags,
          fraudAnalysis: fraudResult.analysis as unknown as Prisma.InputJsonValue,
          note: dto.note?.trim() || null,
        },
        include: {
          driver: { select: { fullName: true, phone: true } },
          vehicle: { select: { plateNumber: true, model: true } },
        },
      });

      // 3. Mas'ullarga Telegram orqali ogohlantirish yuborish
      try {
        const company = await tx.company.findUnique({ where: { id: tenantId }, select: { name: true } });
        const companyName = company?.name ?? "Kompaniya";
        const riskEmoji = fraudResult.risk === "HIGH" ? "🛑" : fraudResult.risk === "MEDIUM" ? "⚠️" : "✅";
        const riskLabel = fraudResult.risk === "HIGH" ? "YUQORI (Qalbaki bo'lishi mumkin!)" : fraudResult.risk === "MEDIUM" ? "O'RTA" : "PAST (Toza)";

        const notificationText = [
          `<b>${escapeTelegramHtml(companyName)}</b>`,
          `📩 <b>Yangi to'lov cheki keldi!</b>`,
          `Haydovchi: <b>${escapeTelegramHtml(created.driver.fullName)}</b>`,
          `Avtomobil: <b>${escapeTelegramHtml(created.vehicle.plateNumber)}</b>`,
          `Summa: <b>${formatMoney(created.amount.toFixed(2))}</b>`,
          dto.transactionNumber ? `Tranzaksiya: <code>${escapeTelegramHtml(dto.transactionNumber)}</code>` : "",
          `Soxtalik xavfi: ${riskEmoji} <b>${riskLabel}</b> (Ball: ${fraudResult.score}/100)`,
          fraudResult.flags.length > 0 ? `Belgilar: <i>${escapeTelegramHtml(fraudResult.flags.join(", "))}</i>` : "",
          `\n<i>Web panelda "To'lov arizalari" bo'limida tekshiring va tasdiqlang.</i>`,
        ].filter(Boolean).join("\n");

        const staff = await tx.telegramAccount.findMany({
          where: {
            user: {
              is: {
                isActive: true,
                role: { in: ["OWNER", "ADMIN", "ACCOUNTANT"] },
              },
            },
          },
          select: { chatId: true },
        });

        for (const s of staff) {
          await this.telegramNotifier.send(s.chatId.toString(), notificationText).catch(() => undefined);
        }
      } catch (err) {
        this.logger.warn(`Submission notification xatosi: ${String(err)}`);
      }

      return {
        id: created.id,
        amount: created.amount.toFixed(2),
        status: created.status,
        fraudRisk: created.fraudRisk,
        fraudScore: created.fraudScore,
        fraudFlags: created.fraudFlags,
        recommendation: fraudResult.analysis.recommendation,
      };
    });
  }

  /**
   * Arizalar ro'yxatini olish (Web panel)
   */
  async listSubmissions(
    tenantId: string,
    query: {
      status?: string;
      driverId?: string;
      risk?: string;
      page?: string;
      limit?: string;
    },
  ) {
    const page = Math.max(1, Number(query.page) || 1);
    const take = Math.min(100, Math.max(1, Number(query.limit) || 25));
    const skip = (page - 1) * take;

    return this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const where: Prisma.PaymentSubmissionWhereInput = {
        ...(query.status ? { status: query.status as any } : {}),
        ...(query.driverId ? { driverId: query.driverId } : {}),
        ...(query.risk ? { fraudRisk: query.risk as any } : {}),
      };

      const [items, total] = await Promise.all([
        tx.paymentSubmission.findMany({
          where,
          include: {
            driver: { select: { id: true, fullName: true, phone: true } },
            vehicle: { select: { id: true, plateNumber: true, model: true } },
            reviewedBy: { select: { id: true, fullName: true } },
          },
          orderBy: { createdAt: "desc" },
          take,
          skip,
        }),
        tx.paymentSubmission.count({ where }),
      ]);

      const itemsWithUrls = await Promise.all(
        items.map(async (item) => {
          let downloadUrl: string | null = null;
          try {
            downloadUrl = await this.storage.presignDownload(
              item.receiptFileKey,
              `chek_${item.id.slice(0, 8)}.jpg`,
            );
          } catch {
            downloadUrl = null;
          }
          return {
            ...item,
            amount: item.amount.toFixed(2),
            receiptFileUrl: downloadUrl,
          };
        }),
      );

      return {
        items: itemsWithUrls,
        total,
        page,
        pageSize: take,
      };
    });
  }

  /**
   * Chekni tasdiqlash (Mablag' tushgani aniqlanganda)
   */
  async approveSubmission(
    actor: AuthenticatedUser,
    id: string,
    dto: ApproveSubmissionDto,
    ip: string | null,
  ) {
    return this.tenantPrisma.withTenant(actor.tenantId, async (tx) => {
      const submission = await tx.paymentSubmission.findFirst({
        where: { id },
        include: {
          driver: { select: { id: true, fullName: true, telegramChatId: true } },
          vehicle: { select: { id: true, plateNumber: true, model: true, route: { select: { monthlyPlan: true } } } },
        },
      });

      if (!submission) throw new NotFoundException("To'lov arizasi topilmadi");
      if (submission.status !== "PENDING") {
        throw new ConflictException(`Ushbu ariza allaqachon ${submission.status} holatida`);
      }

      const now = new Date();
      const period = submission.periodStart;
      const fee = effectiveMonthlyFee<Prisma.Decimal>(submission.vehicle as any);

      // Rejani tekshirish yoki yaratish
      let plan = await tx.vehicleMonthlyPlan.findFirst({
        where: { vehicleId: submission.vehicleId, periodStart: period },
      });
      if (!plan && fee.gt(0)) {
        plan = await tx.vehicleMonthlyPlan.create({
          data: {
            tenantId: actor.tenantId,
            vehicleId: submission.vehicleId,
            driverId: submission.driverId,
            periodStart: period,
            amount: fee,
          },
        });
      }

      // Rasmiy DriverPayment yaratish
      const driverPayment = await tx.driverPayment.create({
        data: {
          tenantId: actor.tenantId,
          driverId: submission.driverId,
          vehicleId: submission.vehicleId,
          monthlyPlanId: plan?.id ?? null,
          amount: submission.amount,
          method: "CARD",
          periodStart: period,
          paidAt: now,
          source: "REMOTE_RECEIPT",
          note: dto.note?.trim() || `Masofaviy chek tasdiqlandi (#${submission.id.slice(0, 8)})`,
          receivedById: actor.userId,
          idempotencyKey: `submission_${submission.id}`,
        },
      });

      // Arizani APPROVED holatiga o'tkazish
      const updated = await tx.paymentSubmission.update({
        where: { id: submission.id },
        data: {
          status: "APPROVED",
          driverPaymentId: driverPayment.id,
          reviewedById: actor.userId,
          reviewedAt: now,
          note: dto.note?.trim() || submission.note,
        },
      });

      await this.audit.record(tx, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: "payment_submission.approved",
        entityType: "PaymentSubmission",
        entityId: submission.id,
        metadata: {
          amount: submission.amount.toFixed(2),
          driverId: submission.driverId,
          driverPaymentId: driverPayment.id,
        },
        ip,
      });

      // Haydovchiga kvitansiya xabarini Telegram botga yuborish
      if (submission.driver.telegramChatId) {
        const company = await tx.company.findUnique({ where: { id: actor.tenantId }, select: { name: true } });
        const companyName = company?.name ?? "Kompaniya";
        const driverMsg = [
          `<b>${escapeTelegramHtml(companyName)}</b>`,
          `✅ <b>Masofaviy to'lovingiz tasdiqlandi!</b>`,
          `Avtomobil: <b>${escapeTelegramHtml(submission.vehicle.plateNumber)}</b>`,
          `To'langan summa: <b>${formatMoney(submission.amount.toFixed(2))}</b> (Plastik karta)`,
          `Tasdiqladi: ${escapeTelegramHtml(actor.fullName)}`,
          `Vaqt: ${now.toLocaleString("uz-UZ")}`,
          `\n<i>Rahmat, to'lov hisobga olindi!</i>`,
        ].join("\n");

        await this.telegramNotifier.send(submission.driver.telegramChatId.toString(), driverMsg).catch(() => undefined);
      }

      return {
        id: updated.id,
        status: updated.status,
        driverPaymentId: driverPayment.id,
      };
    });
  }

  /**
   * Chekni rad etish (Soxta yoki pul tushmagan bo'lsa)
   */
  async rejectSubmission(
    actor: AuthenticatedUser,
    id: string,
    dto: RejectSubmissionDto,
    ip: string | null,
  ) {
    return this.tenantPrisma.withTenant(actor.tenantId, async (tx) => {
      const submission = await tx.paymentSubmission.findFirst({
        where: { id },
        include: {
          driver: { select: { fullName: true, telegramChatId: true } },
          vehicle: { select: { plateNumber: true } },
        },
      });

      if (!submission) throw new NotFoundException("To'lov arizasi topilmadi");
      if (submission.status !== "PENDING") {
        throw new ConflictException(`Ushbu ariza allaqachon ${submission.status} holatida`);
      }

      const now = new Date();
      const updated = await tx.paymentSubmission.update({
        where: { id: submission.id },
        data: {
          status: "REJECTED",
          reviewedById: actor.userId,
          reviewedAt: now,
          rejectReason: dto.reason.trim(),
        },
      });

      await this.audit.record(tx, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: "payment_submission.rejected",
        entityType: "PaymentSubmission",
        entityId: submission.id,
        metadata: {
          reason: dto.reason,
          driverId: submission.driverId,
        },
        ip,
      });

      // Haydovchiga xabar
      if (submission.driver.telegramChatId) {
        const company = await tx.company.findUnique({ where: { id: actor.tenantId }, select: { name: true } });
        const companyName = company?.name ?? "Kompaniya";
        const driverMsg = [
          `<b>${escapeTelegramHtml(companyName)}</b>`,
          `❌ <b>To'lov cheki rad etildi</b>`,
          `Avtomobil: <b>${escapeTelegramHtml(submission.vehicle.plateNumber)}</b>`,
          `Summa: <b>${formatMoney(submission.amount.toFixed(2))}</b>`,
          `Sabab: <b>${escapeTelegramHtml(dto.reason)}</b>`,
          `\n<i>Iltimos, qaytadan tekshiring yoki buxgalteriyaga murojaat qiling.</i>`,
        ].join("\n");

        await this.telegramNotifier.send(submission.driver.telegramChatId.toString(), driverMsg).catch(() => undefined);
      }

      return {
        id: updated.id,
        status: updated.status,
        rejectReason: updated.rejectReason,
      };
    });
  }
}
