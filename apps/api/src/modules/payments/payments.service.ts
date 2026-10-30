import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { PaymentStatus, Prisma, type PaymentProvider } from "@prisma/client";
import { z } from "zod";
import { TenantPrismaService } from "../../common/prisma/tenant-prisma.service";
import { money } from "../../common/money/money";
import { AuditService } from "../audit/audit.service";
import type { AuthenticatedUser } from "../../common/auth/auth.types";
import { verifyWebhookSignature } from "./webhook-signature";
import { CreatePaymentDto, MarkPaymentPaidDto } from "./dto/payment.dto";
import { ConfigService } from "@nestjs/config";
import { PaymeService } from "./payme.service";
import { NotificationsQueueService } from "../notifications/notifications.queue";

const webhookPayloadSchema = z.object({
  tenantSlug: z.string().min(1).max(64),
  eventId: z.string().min(8).max(160),
  paymentId: z.string().uuid(),
  status: z.enum(["PAID", "FAILED", "CANCELLED"]),
  amount: z
    .string()
    .regex(/^\d{1,16}(\.\d{1,2})?$/)
    .optional(),
});

function serializePayment<
  T extends { amount: Prisma.Decimal; [key: string]: unknown },
>(payment: T) {
  return { ...payment, amount: payment.amount.toFixed(2) };
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly payme: PaymeService,
    private readonly notifications: NotificationsQueueService,
  ) {}

  async list(tenantId: string) {
    return this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const items = await tx.payment.findMany({
        orderBy: { createdAt: "desc" },
        take: 200,
        include: {
          contract: {
            select: {
              id: true,
              type: true,
              vehicle: { select: { plateNumber: true, model: true } },
              owner: { select: { fullName: true } },
            },
          },
        },
      });
      return { items: items.map(serializePayment) };
    });
  }

  async createManual(
    actor: AuthenticatedUser,
    dto: CreatePaymentDto,
    idempotencyKey: string,
    ip: string | null,
  ) {
    const amount = money(dto.amount);
    if (amount.lte(0)) throw new BadRequestException("Summa noldan katta bo'lishi kerak");
    if (!/^[A-Za-z0-9_.:-]{8,120}$/.test(idempotencyKey)) {
      throw new BadRequestException(
        "Idempotency-Key sarlavhasi 8-120 belgidan iborat bo'lishi kerak",
      );
    }

    try {
      const result = await this.tenantPrisma.withTenant(actor.tenantId, async (tx) => {
        const existing = await tx.payment.findUnique({
          where: {
            tenantId_idempotencyKey: {
              tenantId: actor.tenantId,
              idempotencyKey,
            },
          },
        });
        if (existing) {
          const sameRequest =
            existing.contractId === dto.contractId &&
            existing.amount.eq(amount) &&
            existing.method === dto.method;
          if (!sameRequest) {
            throw new ConflictException(
              "Idempotency-Key boshqa ma'lumot bilan ishlatilgan",
            );
          }
          return { payment: serializePayment(existing), idempotentReplay: true };
        }

        const contract = await tx.contract.findFirst({
          where: { id: dto.contractId, status: "ACTIVE" },
        });
        if (!contract) {
          throw new BadRequestException("Faol shartnoma topilmadi");
        }
        if (dto.provider === "PAYME") {
          const account = await tx.paymentProviderAccount.findFirst({
            where: { provider: "PAYME", isActive: true },
          });
          if (!account) {
            throw new BadRequestException(
              "Payme provayderi sozlanmagan. Sozlamalar → To'lovlar bo'limida kalitni kiriting.",
            );
          }
        }

        const payment = await tx.payment.create({
          data: {
            tenantId: actor.tenantId,
            contractId: dto.contractId,
            createdById: actor.userId,
            amount,
            method: dto.method,
            status: PaymentStatus.PENDING,
            description: dto.description?.trim() || null,
            idempotencyKey,
            provider: dto.provider ?? null,
          },
        });
        await this.audit.record(tx, {
          tenantId: actor.tenantId,
          actorUserId: actor.userId,
          action: "payment.created",
          entityType: "Payment",
          entityId: payment.id,
          metadata: {
            amount: amount.toFixed(2),
            method: payment.method,
            contractId: payment.contractId,
            provider: payment.provider,
          },
          ip,
        });
        return { payment: serializePayment(payment), idempotentReplay: false };
      });
      return await this.attachCheckout(actor, dto.provider, result, ip);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        // Concurrent retry with the same key: return the winner.
        const existing = await this.tenantPrisma.withTenant(actor.tenantId, (tx) =>
          tx.payment.findUnique({
            where: {
              tenantId_idempotencyKey: {
                tenantId: actor.tenantId,
                idempotencyKey,
              },
            },
          }),
        );
        if (existing) {
          return await this.attachCheckout(
            actor,
            dto.provider,
            { payment: serializePayment(existing), idempotentReplay: true },
            ip,
          );
        }
      }
      throw error;
    }
  }

  private async attachCheckout<T extends { payment: { id: string; status: string } }>(
    actor: AuthenticatedUser,
    provider: PaymentProvider | undefined,
    result: T,
    ip: string | null,
  ): Promise<T & { checkoutUrl?: string }> {
    if (provider !== "PAYME" || result.payment.status !== "PENDING") return result;
    const link = await this.payme.createCheckoutLink(actor, result.payment.id, ip);
    return { ...result, checkoutUrl: link.url };
  }

  async markPaid(
    actor: AuthenticatedUser,
    id: string,
    dto: MarkPaymentPaidDto,
    ip: string | null,
  ) {
    const result = await this.tenantPrisma.withTenant(actor.tenantId, async (tx) => {
      const payment = await tx.payment.findFirst({ where: { id } });
      if (!payment) throw new NotFoundException("To'lov topilmadi");
      if (payment.status === PaymentStatus.PAID) {
        return { payment: serializePayment(payment), idempotentReplay: true };
      }
      if (payment.status !== PaymentStatus.PENDING) {
        throw new BadRequestException(
          `"${payment.status}" holatidagi to'lovni to'langan deb belgilab bo'lmaydi`,
        );
      }

      const updated = await tx.payment.update({
        where: { id },
        data: {
          status: PaymentStatus.PAID,
          paidAt: new Date(),
          ...(dto.note ? { description: `${payment.description ?? ""}\n${dto.note}`.trim() } : {}),
        },
      });
      await this.audit.record(tx, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: "payment.marked_paid",
        entityType: "Payment",
        entityId: id,
        metadata: { amount: payment.amount.toFixed(2), note: dto.note ?? null },
        ip,
      });
      return { payment: serializePayment(updated), idempotentReplay: false };
    });

    if (!result.idempotentReplay) {
      await this.notifications.enqueue({
        tenantId: actor.tenantId,
        type: "payment.paid",
        dedupeKey: `payment__${id}__marked_paid`,
        occurredAt: new Date().toISOString(),
        data: { paymentId: id, amount: result.payment.amount },
      });
    }
    return result;
  }

  async handleWebhook(input: {
    provider: string;
    rawBody: string;
    timestamp: string | undefined;
    signature: string | undefined;
    ip: string | null;
  }): Promise<{ received: true; outcome: string; paymentId?: string }> {
    if (!input.timestamp || !input.signature) {
      throw new UnauthorizedException("Webhook imzosi yo'q");
    }
    const secret = this.config.getOrThrow<string>("PAYMENT_WEBHOOK_SECRET");
    if (
      !verifyWebhookSignature({
        rawBody: input.rawBody,
        timestamp: input.timestamp,
        signature: input.signature,
        secret,
      })
    ) {
      throw new UnauthorizedException("Webhook imzosi yaroqsiz");
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(input.rawBody);
    } catch {
      throw new BadRequestException("Webhook JSON yaroqsiz");
    }
    const parsed = webhookPayloadSchema.safeParse(parsedJson);
    if (!parsed.success) {
      throw new BadRequestException("Webhook ma'lumotlari yaroqsiz");
    }
    const payload = parsed.data;
    const provider = input.provider;
    if (!/^[a-z0-9_-]{1,60}$/.test(provider)) {
      throw new BadRequestException("Provayder nomi yaroqsiz");
    }

    const tenantId = await this.tenantPrisma.resolveTenantIdBySlug(payload.tenantSlug);
    if (!tenantId) {
      // Do not disclose whether the tenant exists.
      throw new UnauthorizedException("Webhook qabul qilinmadi");
    }

    const outcome = await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const existingEvent = await tx.paymentWebhookEvent.findUnique({
        where: {
          tenantId_provider_externalEventId: {
            tenantId,
            provider,
            externalEventId: payload.eventId,
          },
        },
      });
      if (existingEvent?.status === "PROCESSED") {
        return {
          kind: "idempotent" as const,
          paymentId: existingEvent.paymentId ?? undefined,
        };
      }

      const payment = await tx.payment.findFirst({
        where: { id: payload.paymentId },
      });
      if (!payment) {
        const error = "To'lov topilmadi";
        if (existingEvent) {
          await tx.paymentWebhookEvent.update({
            where: { id: existingEvent.id },
            data: { status: "FAILED", error },
          });
        } else {
          await tx.paymentWebhookEvent.create({
            data: {
              tenantId,
              provider,
              externalEventId: payload.eventId,
              payload: parsedJson as Prisma.InputJsonValue,
              status: "FAILED",
              error,
            },
          });
        }
        return { kind: "not_found" as const };
      }

      if (payload.amount && !money(payload.amount).eq(payment.amount)) {
        const error = "Webhook summasi to'lov summasi bilan mos emas";
        const data = {
          status: "FAILED" as const,
          error,
          paymentId: payment.id,
        };
        if (existingEvent) {
          await tx.paymentWebhookEvent.update({ where: { id: existingEvent.id }, data });
        } else {
          await tx.paymentWebhookEvent.create({
            data: {
              tenantId,
              provider,
              externalEventId: payload.eventId,
              payload: parsedJson as Prisma.InputJsonValue,
              ...data,
            },
          });
        }
        return { kind: "amount_mismatch" as const };
      }

      const eventData = {
        status: "PROCESSED" as const,
        error: null,
        paymentId: payment.id,
        processedAt: new Date(),
      };
      if (existingEvent) {
        await tx.paymentWebhookEvent.update({ where: { id: existingEvent.id }, data: eventData });
      } else {
        await tx.paymentWebhookEvent.create({
          data: {
            tenantId,
            provider,
            externalEventId: payload.eventId,
            payload: parsedJson as Prisma.InputJsonValue,
            ...eventData,
          },
        });
      }

      let appliedStatus: PaymentStatus | null = null;
      if (payment.status === "PENDING") {
        const target =
          payload.status === "PAID"
            ? PaymentStatus.PAID
            : payload.status === "FAILED"
              ? PaymentStatus.FAILED
              : PaymentStatus.CANCELLED;
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: target,
            ...(target === PaymentStatus.PAID ? { paidAt: new Date() } : {}),
            ...(target === PaymentStatus.FAILED
              ? { failureReason: "Provayder rad etdi" }
              : {}),
            provider,
          },
        });
        appliedStatus = target;
      }

      await this.audit.record(tx, {
        tenantId,
        actorType: "INTEGRATION",
        action: "payment.webhook_processed",
        entityType: "Payment",
        entityId: payment.id,
        metadata: {
          provider,
          externalEventId: payload.eventId,
          requestedStatus: payload.status,
          previousStatus: payment.status,
        },
        ip: input.ip,
      });
      return {
        kind: "processed" as const,
        paymentId: payment.id,
        appliedStatus,
        amount: payment.amount.toFixed(2),
      };
    });

    if (outcome.kind === "not_found") {
      throw new NotFoundException("To'lov topilmadi");
    }
    if (outcome.kind === "amount_mismatch") {
      throw new BadRequestException("Webhook summasi mos emas");
    }
    if (outcome.kind === "processed" && outcome.appliedStatus) {
      const notificationType =
        outcome.appliedStatus === PaymentStatus.PAID
          ? ("payment.paid" as const)
          : outcome.appliedStatus === PaymentStatus.FAILED
            ? ("payment.failed" as const)
            : null;
      if (notificationType) {
        await this.notifications.enqueue({
          tenantId,
          type: notificationType,
          dedupeKey: `payment__${outcome.paymentId}__${notificationType.split(".")[1]}`,
          occurredAt: new Date().toISOString(),
          data: { paymentId: outcome.paymentId, amount: outcome.amount },
        });
      }
    }
    this.logger.log(
      `webhook provider=${provider} outcome=${outcome.kind} payment=${outcome.paymentId ?? "-"}`,
    );
    return {
      received: true,
      outcome: outcome.kind,
      ...(outcome.paymentId ? { paymentId: outcome.paymentId } : {}),
    };
  }
}
