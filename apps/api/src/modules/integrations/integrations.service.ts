import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { TenantPrismaService } from "../../common/prisma/tenant-prisma.service";
import { AuditService } from "../audit/audit.service";
import { DriversService } from "../drivers/drivers.service";
import { NotificationsService } from "../notifications/notifications.service";
import { TelegramNotifier } from "../notifications/telegram.notifier";
import { SubmissionsService } from "../submissions/submissions.service";
import {
  EndShiftBotDto,
  ReportIncidentBotDto,
  StartShiftBotDto,
  SubmitReceiptBotDto,
} from "./dto/telegram.dto";
import {
  DRIVER_PHOTO_KINDS,
  type DriverDocumentField,
  type DriverPhotoKind,
} from "../drivers/documents";
import type { AuthenticatedUser } from "../../common/auth/auth.types";
import { WaybillsService } from "../waybills/waybills.service";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function parseChatId(value: string): bigint {
  if (!/^-?\d{5,20}$/.test(value)) {
    throw new BadRequestException("chatId noto'g'ri");
  }
  return BigInt(value);
}

@Injectable()
export class IntegrationsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
    private readonly drivers: DriversService,
    private readonly submissions: SubmissionsService,
    private readonly notifier: TelegramNotifier,
    private readonly waybills: WaybillsService,
  ) {}

  async linkStatus(tenantId: string, userId: string) {
    return this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const account = await tx.telegramAccount.findUnique({
        where: { tenantId_userId: { tenantId, userId } },
      });
      return account
        ? {
            linked: true,
            username: account.username,
            chatId: account.chatId.toString(),
            linkedAt: account.linkedAt,
          }
        : { linked: false };
    });
  }

  async createLinkToken(actor: AuthenticatedUser, ip: string | null) {
    const token = randomBytes(32).toString("base64url");
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await this.tenantPrisma.withTenant(actor.tenantId, async (tx) => {
      await tx.telegramLinkToken.updateMany({
        where: { userId: actor.userId, usedAt: null },
        data: { usedAt: new Date() },
      });
      await tx.telegramLinkToken.create({
        data: {
          tenantId: actor.tenantId,
          userId: actor.userId,
          tokenHash,
          expiresAt,
        },
      });
      await this.audit.record(tx, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: "telegram.link_token_created",
        entityType: "TelegramLinkToken",
        entityId: null,
        metadata: { expiresAt: expiresAt.toISOString() },
        ip,
      });
    });

    return { token, expiresAt };
  }

  async link(
    input: { token: string; chatId: string; username?: string },
    ip: string | null,
  ) {
    const chatId = parseChatId(input.chatId);
    const tokenHash = hashToken(input.token);

    const linked = await this.tenantPrisma.consumeTelegramLinkToken(
      tokenHash,
      chatId,
      input.username ?? null,
    );
    if (linked) {
      const profile = await this.tenantPrisma.withTenant(linked.tenantId, async (tx) => {
        const user = await tx.user.findFirst({
          where: { id: linked.userId, isActive: true },
          select: {
            fullName: true,
            company: { select: { name: true } },
          },
        });
        if (!user) throw new UnauthorizedException("Foydalanuvchi faol emas");
        await this.audit.record(tx, {
          tenantId: linked.tenantId,
          actorUserId: linked.userId,
          actorType: "INTEGRATION",
          action: "telegram.linked",
          entityType: "TelegramAccount",
          entityId: linked.userId,
          metadata: { username: input.username ?? null },
          ip,
        });
        return { fullName: user.fullName, companyName: user.company.name };
      });

      return { linked: true, kind: "user" as const, ...profile };
    }

    const driverLink = await this.tenantPrisma.consumeDriverLinkToken(
      tokenHash,
      chatId,
      input.username ?? null,
    );
    if (driverLink) {
      const profile = await this.tenantPrisma.withTenant(
        driverLink.tenantId,
        async (tx) => {
          const driver = await tx.driver.findFirst({
            where: { id: driverLink.driverId },
            select: {
              fullName: true,
              company: { select: { name: true } },
            },
          });
          if (!driver) throw new UnauthorizedException("Haydovchi faol emas");
          await this.audit.record(tx, {
            tenantId: driverLink.tenantId,
            actorType: "INTEGRATION",
            action: "telegram.driver_linked",
            entityType: "Driver",
            entityId: driverLink.driverId,
            metadata: { username: input.username ?? null },
            ip,
          });
          return { fullName: driver.fullName, companyName: driver.company.name };
        },
      );

      return { linked: true, kind: "driver" as const, ...profile };
    }

    throw new UnauthorizedException("Bog'lash kodi yaroqsiz yoki muddati tugagan");
  }

  private async resolveChat(chatIdRaw: string) {
    const resolved = await this.tenantPrisma.resolveTelegramChat(parseChatId(chatIdRaw));
    if (!resolved) {
      throw new UnauthorizedException(
        "Telegram akkaunt bog'lanmagan. Web panelda bog'lash kodini oling.",
      );
    }
    return resolved;
  }

  private async resolveDriverChat(chatIdRaw: string) {
    const resolved = await this.tenantPrisma.resolveDriverChat(parseChatId(chatIdRaw));
    if (!resolved) {
      throw new UnauthorizedException(
        "Telegram akkaunt haydovchiga bog'lanmagan. Kodni web paneldan oling.",
      );
    }
    return resolved;
  }

  /** Qaysi turdagi akkaunt bog'langanini aniqlash (bot menyusi uchun). */
  async whoami(chatIdRaw: string) {
    const chatId = parseChatId(chatIdRaw);
    const user = await this.tenantPrisma.resolveTelegramChat(chatId);
    if (user) {
      const profile = await this.botProfile(chatIdRaw);
      return { kind: "user" as const, ...profile };
    }
    const driver = await this.tenantPrisma.resolveDriverChat(chatId);
    if (driver) {
      const profile = await this.drivers.botDriverProfile(
        driver.tenantId,
        driver.driverId,
      );
      return {
        kind: "driver" as const,
        fullName: profile.fullName,
        companyName: profile.companyName,
        vehicle: profile.vehicle,
      };
    }
    throw new UnauthorizedException(
      "Telegram akkaunt bog'lanmagan. Web panelda bog'lash kodini oling.",
    );
  }

  async botDriver(chatIdRaw: string) {
    const { tenantId, driverId } = await this.resolveDriverChat(chatIdRaw);
    return this.drivers.botDriverProfile(tenantId, driverId);
  }

  async botDriverWaybill(chatIdRaw: string) {
    const { tenantId, driverId } = await this.resolveDriverChat(chatIdRaw);
    return this.waybills.getDriverActiveWaybill(tenantId, driverId);
  }

  async linkPhone(
    input: {
      phone: string;
      chatId: string;
      username?: string;
      firstName?: string;
      lastName?: string;
      photoFileId?: string;
    },
    ip: string | null,
  ) {
    const chatId = parseChatId(input.chatId);
    const result = await this.tenantPrisma.linkDriverByPhone(input.phone, chatId, {
      username: input.username ?? null,
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
    });
    if (result.status === "ambiguous") {
      throw new ConflictException(
        "Bu raqam bir nechta kompaniyada ro'yxatda. Dispetcherdan bog'lash kodini oling.",
      );
    }
    if (result.status !== "linked") {
      throw new NotFoundException(
        "Bu telefon raqami haydovchilar ro'yxatida topilmadi. Dispetcherga murojaat qiling.",
      );
    }
    const { tenantId, driverId } = result;
    if (input.photoFileId) {
      await this.drivers.syncTelegramProfile(tenantId, driverId, {
        photoFileId: input.photoFileId,
      });
    }
    const profile = await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const driver = await tx.driver.findFirst({
        where: { id: driverId },
        select: { fullName: true, company: { select: { name: true } } },
      });
      if (!driver) throw new UnauthorizedException("Haydovchi faol emas");
      await this.audit.record(tx, {
        tenantId,
        actorType: "INTEGRATION",
        action: "telegram.driver_linked",
        entityType: "Driver",
        entityId: driverId,
        metadata: { method: "phone", username: input.username ?? null },
        ip,
      });
      return { fullName: driver.fullName, companyName: driver.company.name };
    });
    return { linked: true, kind: "driver" as const, ...profile };
  }

  async syncDriverTelegram(input: {
    chatId: string;
    username?: string;
    firstName?: string;
    lastName?: string;
    photoFileId?: string;
  }) {
    const { tenantId, driverId } = await this.resolveDriverChat(input.chatId);
    return this.drivers.syncTelegramProfile(tenantId, driverId, {
      username: input.username ?? null,
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
      photoFileId: input.photoFileId ?? null,
    });
  }

  async botDriverDocuments(chatIdRaw: string) {
    const { tenantId, driverId } = await this.resolveDriverChat(chatIdRaw);
    return this.drivers.documents(tenantId, driverId);
  }

  /** Bot haydovchining yuklangan hujjat rasmini file_id orqali yuboradi. */
  async botDriverPhoto(chatIdRaw: string, kind: string) {
    const { tenantId, driverId } = await this.resolveDriverChat(chatIdRaw);
    if (!(DRIVER_PHOTO_KINDS as readonly string[]).includes(kind)) {
      throw new BadRequestException("Rasm turi noto'g'ri");
    }
    const fileId = await this.drivers.photoFileId(
      tenantId,
      driverId,
      kind as DriverPhotoKind,
    );
    return { fileId };
  }

  async botPaymentCard(chatIdRaw: string) {
    const { tenantId } = await this.resolveDriverChat(chatIdRaw);
    return this.submissions.getPaymentInfo(tenantId);
  }

  async submitReceipt(dto: SubmitReceiptBotDto) {
    const { tenantId, driverId } = await this.resolveDriverChat(dto.chatId);
    const buffer = Buffer.from(dto.base64Data, "base64");
    return this.submissions.createSubmission(tenantId, driverId, buffer, dto.filename, {
      amount: dto.amount,
      transactionNumber: dto.transactionNumber,
      note: dto.note,
    });
  }

  async updateBotDriverDocument(
    input: { chatId: string; field: DriverDocumentField; value: string },
    ip: string | null,
  ) {
    const { tenantId, driverId } = await this.resolveDriverChat(input.chatId);
    return this.drivers.updateDocuments(
      tenantId,
      driverId,
      { [input.field]: input.value },
      { userId: null, source: "BOT" },
      ip,
    );
  }

  async botProfile(chatIdRaw: string) {
    const { tenantId, userId } = await this.resolveChat(chatIdRaw);
    return this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const user = await tx.user.findFirst({
        where: { id: userId, isActive: true },
        select: {
          fullName: true,
          role: true,
          company: { select: { name: true, slug: true } },
        },
      });
      if (!user) throw new UnauthorizedException("Foydalanuvchi faol emas");
      return {
        fullName: user.fullName,
        role: user.role,
        companyName: user.company.name,
        companySlug: user.company.slug,
      };
    });
  }

  async botSummary(chatIdRaw: string) {
    const { tenantId, userId } = await this.resolveChat(chatIdRaw);
    return this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const [contracts, pending, paid] = await Promise.all([
        tx.contract.count({ where: { ownerId: userId, status: "ACTIVE" } }),
        tx.payment.aggregate({
          where: {
            status: "PENDING",
            contract: { ownerId: userId },
          },
          _sum: { amount: true },
          _count: true,
        }),
        tx.payment.aggregate({
          where: {
            status: "PAID",
            contract: { ownerId: userId },
            paidAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
          },
          _sum: { amount: true },
        }),
      ]);
      return {
        activeContracts: contracts,
        pendingCount: pending._count,
        pendingAmount: pending._sum.amount?.toFixed(2) ?? "0.00",
        paidLast30Days: paid._sum.amount?.toFixed(2) ?? "0.00",
      };
    });
  }

  async botContracts(chatIdRaw: string) {
    const { tenantId, userId } = await this.resolveChat(chatIdRaw);
    return this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const items = await tx.contract.findMany({
        where: { ownerId: userId },
        orderBy: { createdAt: "desc" },
        take: 20,
        include: {
          vehicle: { select: { plateNumber: true, model: true } },
          tariff: { select: { name: true } },
        },
      });
      return {
        items: items.map((contract) => ({
          id: contract.id,
          type: contract.type,
          status: contract.status,
          startDate: contract.startDate,
          endDate: contract.endDate,
          monthlyRate: contract.monthlyRate?.toFixed(2) ?? null,
          vehicle: contract.vehicle,
          tariffName: contract.tariff?.name ?? null,
        })),
      };
    });
  }

  async botPayments(chatIdRaw: string) {
    const { tenantId, userId } = await this.resolveChat(chatIdRaw);
    return this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const items = await tx.payment.findMany({
        where: { contract: { ownerId: userId } },
        orderBy: { createdAt: "desc" },
        take: 10,
        include: {
          contract: {
            select: { vehicle: { select: { plateNumber: true } } },
          },
        },
      });
      return {
        items: items.map((payment) => ({
          id: payment.id,
          amount: payment.amount.toFixed(2),
          status: payment.status,
          method: payment.method,
          createdAt: payment.createdAt,
          plateNumber: payment.contract.vehicle.plateNumber,
        })),
      };
    });
  }

  async botBalance(chatIdRaw: string) {
    const { tenantId, userId } = await this.resolveChat(chatIdRaw);
    return this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const pending = await tx.payment.aggregate({
        where: { status: "PENDING", contract: { ownerId: userId } },
        _sum: { amount: true },
        _count: true,
      });
      return {
        pendingAmount: pending._sum.amount?.toFixed(2) ?? "0.00",
        pendingCount: pending._count,
      };
    });
  }

  async assertContractAccessible(tenantId: string, contractId: string, userId: string) {
    const contract = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.contract.findFirst({ where: { id: contractId, ownerId: userId } }),
    );
    if (!contract) throw new NotFoundException("Shartnoma topilmadi");
    return contract;
  }

  // -------------------------------------------------------------------------
  // Bot smena (Shift) boshqaruvi
  // -------------------------------------------------------------------------

  async botStartShift(dto: StartShiftBotDto) {
    const { tenantId, driverId } = await this.resolveDriverChat(dto.chatId);
    return this.drivers.startShift(tenantId, driverId, dto.startOdometer, dto.note);
  }

  async botEndShift(dto: EndShiftBotDto) {
    const { tenantId, driverId } = await this.resolveDriverChat(dto.chatId);
    return this.drivers.endShift(tenantId, driverId, dto.endOdometer, dto.note);
  }

  async botCurrentShift(chatIdRaw: string) {
    const { tenantId, driverId } = await this.resolveDriverChat(chatIdRaw);
    return this.drivers.getCurrentShift(tenantId, driverId);
  }

  // -------------------------------------------------------------------------
  // Bot SOS va nosozlik xabari
  // -------------------------------------------------------------------------

  async botReportIncident(dto: ReportIncidentBotDto) {
    const { tenantId, driverId } = await this.resolveDriverChat(dto.chatId);
    const incident = await this.drivers.reportIncident(tenantId, driverId, dto.kind, dto.description);

    // Kompaniya dispetcherlari va xodimlariga zudlik bilan Telegram xabar yuborish
    try {
      const staffAccounts = await this.tenantPrisma.withTenant(tenantId, (tx) =>
        tx.telegramAccount.findMany({
          where: { user: { isActive: true } },
          select: { chatId: true },
          take: 20,
        }),
      );

      const alertText = [
        "🚨 <b>FAVQULODDA XABAR / SOS!</b>",
        "",
        `👤 Haydovchi: <b>${incident.driver.fullName}</b> (${incident.driver.phone})`,
        `🚌 Avtomobil: <b>${incident.vehicle.plateNumber}</b> · ${incident.vehicle.model}`,
        incident.vehicle.route?.name ? `🛣 Yo'nalish: <b>${incident.vehicle.route.name}</b>` : "",
        `⚠️ Nosozlik turi: <b>${incident.kind}</b>`,
        incident.description ? `📝 Izoh: <i>${incident.description}</i>` : "",
        `⏰ Vaqt: ${new Date().toLocaleTimeString("uz-UZ")}`,
      ].filter(Boolean).join("\n");

      for (const staff of staffAccounts) {
        await this.notifier.send(staff.chatId.toString(), alertText).catch(() => {});
      }
    } catch {
      // ignore
    }

    return incident;
  }
}
