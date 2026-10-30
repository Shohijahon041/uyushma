import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PaymentProvider, Prisma, RefundStatus } from "@prisma/client";
import { timingSafeEqual } from "node:crypto";
import { money } from "../../common/money/money";
import { TenantPrismaService, type TenantTx } from "../../common/prisma/tenant-prisma.service";
import { EncryptionService } from "../../common/crypto/encryption.service";
import { AuditService } from "../audit/audit.service";
import { MetricsService } from "../../common/metrics/metrics.module";
import type { AuthenticatedUser } from "../../common/auth/auth.types";
import { NotificationsQueueService } from "../notifications/notifications.queue";
import {
  CompleteRefundDto,
  RefundPaymentDto,
  UpsertPaymeAccountDto,
} from "./dto/payment.dto";

const PAYME_STATE = {
  CREATED: 1,
  PERFORMED: 2,
  CANCELLED: -1,
  CANCELLED_AFTER_PERFORM: -2,
} as const;

const PAYME_ERROR = {
  AUTH: -32504,
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_AMOUNT: -31001,
  TRANSACTION_NOT_FOUND: -31003,
  UNABLE_TO_PERFORM: -31008,
  ORDER_NOT_FOUND: -31050,
  ALREADY_PAID: -31051,
  ORDER_CANCELLED: -31052,
  CONTRACT_INACTIVE: -31053,
} as const;

interface RpcRequest {
  id: string | number | null;
  method: string;
  params: Record<string, unknown>;
}

interface RpcError {
  jsonrpc: "2.0";
  id: string | number | null;
  error: { code: number; message: string };
}

interface RpcResult {
  jsonrpc: "2.0";
  id: string | number | null;
  result: Record<string, unknown>;
}

function rpcError(id: string | number | null, code: number, message: string): RpcError {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function rpcResult(id: string | number | null, result: Record<string, unknown>): RpcResult {
  return { jsonrpc: "2.0", id, result };
}

function asString(value: unknown, max = 160): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= max
    ? value
    : null;
}

function asSafeInteger(value: unknown): number | null {
  const number = typeof value === "string" ? Number(value) : value;
  return typeof number === "number" && Number.isSafeInteger(number) ? number : null;
}

function accountOrderId(params: Record<string, unknown>): string | null {
  const account = params.account;
  if (!account || typeof account !== "object") return null;
  const record = account as Record<string, unknown>;
  return (
    asString(record.order_id, 80) ??
    asString(record.payment_id, 80) ??
    asString(record.contract_id, 80)
  );
}

@Injectable()
export class PaymeService {
  private readonly logger = new Logger(PaymeService.name);

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly encryption: EncryptionService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsQueueService,
    private readonly metrics: MetricsService,
  ) {}

  // -------------------------------------------------------------------------
  // Per-tenant provider configuration
  // -------------------------------------------------------------------------

  async getAccount(tenantId: string) {
    return this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const account = await tx.paymentProviderAccount.findUnique({
        where: {
          tenantId_provider: { tenantId, provider: PaymentProvider.PAYME },
        },
      });
      if (!account) return { configured: false };
      const company = await tx.company.findUniqueOrThrow({
        where: { id: tenantId },
        select: { slug: true },
      });
      return {
        configured: true,
        provider: account.provider,
        merchantId: account.merchantId,
        login: account.login,
        isActive: account.isActive,
        webhookPath: `/api/v1/webhooks/payments/payme/${company.slug}`,
        updatedAt: account.updatedAt,
      };
    });
  }

  async upsertAccount(
    actor: AuthenticatedUser,
    dto: UpsertPaymeAccountDto,
    ip: string | null,
  ) {
    const secretEncrypted = this.encryption.encrypt(dto.secret.trim());
    const webhookSecretEncrypted = dto.webhookSecret
      ? this.encryption.encrypt(dto.webhookSecret.trim())
      : null;

    const account = await this.tenantPrisma.withTenant(actor.tenantId, async (tx) => {
      const saved = await tx.paymentProviderAccount.upsert({
        where: {
          tenantId_provider: {
            tenantId: actor.tenantId,
            provider: PaymentProvider.PAYME,
          },
        },
        create: {
          tenantId: actor.tenantId,
          provider: PaymentProvider.PAYME,
          login: dto.login?.trim() || "Paycom",
          merchantId: dto.merchantId.trim(),
          secretEncrypted,
          ...(webhookSecretEncrypted ? { webhookSecretEncrypted } : {}),
          isActive: dto.isActive ?? true,
        },
        update: {
          login: dto.login?.trim() || "Paycom",
          merchantId: dto.merchantId.trim(),
          secretEncrypted,
          ...(webhookSecretEncrypted ? { webhookSecretEncrypted } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
      });
      await this.audit.record(tx, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: "payment.provider_configured",
        entityType: "PaymentProviderAccount",
        entityId: saved.id,
        metadata: {
          provider: "PAYME",
          merchantId: saved.merchantId,
          login: saved.login,
          isActive: saved.isActive,
        },
        ip,
      });
      return saved;
    });

    return {
      configured: true,
      provider: account.provider,
      merchantId: account.merchantId,
      login: account.login,
      isActive: account.isActive,
      updatedAt: account.updatedAt,
    };
  }

  // -------------------------------------------------------------------------
  // Payme Merchant API webhook (JSON-RPC 2.0)
  // -------------------------------------------------------------------------

  async handleRpc(input: {
    tenantSlug: string | null;
    rawBody: string;
    authorization: string | undefined;
    ip: string | null;
  }): Promise<RpcError | RpcResult> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(input.rawBody);
    } catch {
      return rpcError(null, PAYME_ERROR.PARSE, "JSON parsing error");
    }
    if (!parsed || typeof parsed !== "object") {
      return rpcError(null, PAYME_ERROR.INVALID_REQUEST, "Invalid request");
    }
    const record = parsed as Record<string, unknown>;
    const id =
      typeof record.id === "string" || typeof record.id === "number"
        ? record.id
        : null;
    const method = asString(record.method, 80);
    const params =
      record.params && typeof record.params === "object"
        ? (record.params as Record<string, unknown>)
        : {};
    if (!method) {
      return rpcError(id, PAYME_ERROR.INVALID_REQUEST, "Method topilmadi");
    }

    let tenantId: string | null = null;
    if (input.tenantSlug) {
      tenantId = await this.tenantPrisma.resolveTenantIdBySlug(input.tenantSlug);
    } else {
      const orderId = accountOrderId(params);
      if (orderId) tenantId = await this.tenantPrisma.resolvePaymentTenant(orderId);
    }
    if (!tenantId) {
      return rpcError(id, PAYME_ERROR.AUTH, "Ruxsat yo'q");
    }

    const authorized = await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const account = await tx.paymentProviderAccount.findUnique({
        where: {
          tenantId_provider: { tenantId, provider: PaymentProvider.PAYME },
        },
      });
      if (!account || !account.isActive) return false;
      let secret: string;
      try {
        secret = this.encryption.decrypt(account.secretEncrypted);
      } catch {
        return false;
      }
      return this.verifyBasicAuth(
        input.authorization,
        account.login,
        secret,
        account.webhookSecretEncrypted
          ? this.encryption.decrypt(account.webhookSecretEncrypted)
          : null,
      );
    });
    if (!authorized) {
      this.metrics.providerOperations.inc({
        provider: "PAYME",
        operation: method,
        status: "auth_failed",
      });
      return rpcError(id, PAYME_ERROR.AUTH, "Ruxsat yo'q");
    }

    try {
      const response = await this.tenantPrisma.withTenant(tenantId, (tx) =>
        this.dispatchMethod(tx, tenantId!, id, method, params),
      );
      this.metrics.providerOperations.inc({
        provider: "PAYME",
        operation: method,
        status: "ok",
      });
      return response;
    } catch (error) {
      this.metrics.providerOperations.inc({
        provider: "PAYME",
        operation: method,
        status: "error",
      });
      this.logger.error(
        `Payme ${method} xatosi tenant=${tenantId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      if (error instanceof PaymeRpcError) {
        return rpcError(id, error.code, error.message);
      }
      throw error;
    }
  }

  private verifyBasicAuth(
    header: string | undefined,
    login: string,
    secret: string,
    hmacSecret: string | null,
  ): boolean {
    if (!header) return false;
    if (!header.startsWith("Basic ")) {
      // Optional per-tenant HMAC mode for providers that cannot send Basic.
      if (hmacSecret && header.startsWith("HMAC ")) {
        return this.safeStringEqual(header.slice(5), hmacSecret);
      }
      return false;
    }
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    return this.safeStringEqual(decoded, `${login}:${secret}`);
  }

  private safeStringEqual(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    if (left.length !== right.length) return false;
    return timingSafeEqual(left, right);
  }

  private async dispatchMethod(
    tx: TenantTx,
    tenantId: string,
    id: string | number | null,
    method: string,
    params: Record<string, unknown>,
  ): Promise<RpcResult> {
    switch (method) {
      case "CheckPerformTransaction":
        return rpcResult(id, await this.checkPerform(tx, params));
      case "CreateTransaction":
        return rpcResult(id, await this.createTransaction(tx, tenantId, params));
      case "PerformTransaction":
        return rpcResult(id, await this.performTransaction(tx, tenantId, params));
      case "CancelTransaction":
        return rpcResult(id, await this.cancelTransaction(tx, tenantId, params));
      case "CheckTransaction":
        return rpcResult(id, await this.checkTransaction(tx, params));
      case "GetStatement":
        return rpcResult(id, await this.getStatement(tx, params));
      default:
        throw new PaymeRpcError(PAYME_ERROR.METHOD_NOT_FOUND, "Method not found");
    }
  }

  private async loadPayment(tx: TenantTx, orderId: string | null) {
    if (!orderId || !/^[0-9a-f-]{36}$/i.test(orderId)) {
      throw new PaymeRpcError(PAYME_ERROR.ORDER_NOT_FOUND, "Buyurtma topilmadi");
    }
    const payment = await tx.payment.findFirst({
      where: { id: orderId },
      include: {
        contract: { select: { status: true, vehicle: { select: { plateNumber: true } } } },
      },
    });
    if (!payment) {
      throw new PaymeRpcError(PAYME_ERROR.ORDER_NOT_FOUND, "Buyurtma topilmadi");
    }
    return payment;
  }

  private assertAmount(payment: { amount: Prisma.Decimal }, rawAmount: unknown): number {
    const amountTiyin = asSafeInteger(rawAmount);
    if (amountTiyin === null || amountTiyin <= 0) {
      throw new PaymeRpcError(PAYME_ERROR.INVALID_AMOUNT, "Summa noto'g'ri");
    }
    const expected = Math.round(Number(payment.amount.toString()) * 100);
    if (expected !== amountTiyin) {
      throw new PaymeRpcError(PAYME_ERROR.INVALID_AMOUNT, "Summa mos emas");
    }
    return amountTiyin;
  }

  private async checkPerform(tx: TenantTx, params: Record<string, unknown>) {
    const payment = await this.loadPayment(tx, accountOrderId(params));
    this.assertAmount(payment, params.amount);
    if (payment.contract.status !== "ACTIVE") {
      throw new PaymeRpcError(PAYME_ERROR.CONTRACT_INACTIVE, "Shartnoma faol emas");
    }
    if (payment.status === "PAID" || payment.status === "REFUNDED") {
      throw new PaymeRpcError(PAYME_ERROR.ALREADY_PAID, "To'lov allaqachon qilingan");
    }
    if (payment.status === "CANCELLED" || payment.status === "FAILED") {
      throw new PaymeRpcError(PAYME_ERROR.ORDER_CANCELLED, "To'lov bekor qilingan");
    }
    const amount = payment.amount.toFixed(2);
    return {
      allow: true,
      detail: {
        receipt_type: 0,
        shipping: { title: "Transport xizmati" },
        items: [
          {
            title: `To'lov ${payment.contract.vehicle.plateNumber}`,
            price: Math.round(Number(amount) * 100),
            count: 1,
            code: "transport",
            package_code: "transport",
            vat_percent: 0,
          },
        ],
      },
    };
  }

  private async createTransaction(
    tx: TenantTx,
    tenantId: string,
    params: Record<string, unknown>,
  ) {
    const externalId = asString(params.id, 80);
    const createTime = asSafeInteger(params.time);
    if (!externalId || createTime === null) {
      throw new PaymeRpcError(PAYME_ERROR.INVALID_REQUEST, "Tranzaksiya ma'lumoti to'liq emas");
    }
    const existing = await tx.paymentProviderTransaction.findUnique({
      where: {
        tenantId_provider_externalId: {
          tenantId,
          provider: PaymentProvider.PAYME,
          externalId,
        },
      },
    });
    if (existing) {
      return {
        create_time: Number(existing.createTime),
        transaction: existing.paymentId,
        state: existing.state,
      };
    }

    const payment = await this.loadPayment(tx, accountOrderId(params));
    const amountTiyin = this.assertAmount(payment, params.amount);
    if (payment.contract.status !== "ACTIVE") {
      throw new PaymeRpcError(PAYME_ERROR.CONTRACT_INACTIVE, "Shartnoma faol emas");
    }
    if (payment.status === "PAID" || payment.status === "REFUNDED") {
      throw new PaymeRpcError(PAYME_ERROR.ALREADY_PAID, "To'lov allaqachon qilingan");
    }
    if (payment.status !== "PENDING") {
      throw new PaymeRpcError(PAYME_ERROR.ORDER_CANCELLED, "To'lov holati mos emas");
    }

    await tx.paymentProviderTransaction.create({
      data: {
        tenantId,
        paymentId: payment.id,
        provider: PaymentProvider.PAYME,
        externalId,
        state: PAYME_STATE.CREATED,
        amountTiyin: BigInt(amountTiyin),
        createTime: BigInt(createTime),
        raw: this.jsonSafe(params),
      },
    });
    await tx.payment.update({
      where: { id: payment.id },
      data: { provider: PaymentProvider.PAYME, externalRef: externalId },
    });
    await this.audit.record(tx, {
      tenantId,
      actorType: "INTEGRATION",
      action: "payment.payme_transaction_created",
      entityType: "Payment",
      entityId: payment.id,
      metadata: { externalId, amountTiyin, createTime },
    });

    return {
      create_time: createTime,
      transaction: payment.id,
      state: PAYME_STATE.CREATED,
    };
  }

  private async performTransaction(
    tx: TenantTx,
    tenantId: string,
    params: Record<string, unknown>,
  ) {
    const externalId = asString(params.id, 80);
    if (!externalId) {
      throw new PaymeRpcError(PAYME_ERROR.INVALID_REQUEST, "Tranzaksiya id yo'q");
    }
    const transaction = await tx.paymentProviderTransaction.findUnique({
      where: {
        tenantId_provider_externalId: {
          tenantId,
          provider: PaymentProvider.PAYME,
          externalId,
        },
      },
    });
    if (!transaction) {
      throw new PaymeRpcError(PAYME_ERROR.TRANSACTION_NOT_FOUND, "Tranzaksiya topilmadi");
    }
    if (transaction.state === PAYME_STATE.PERFORMED) {
      return {
        perform_time: Number(transaction.performTime ?? 0),
        transaction: transaction.paymentId,
        state: transaction.state,
      };
    }
    if (transaction.state !== PAYME_STATE.CREATED) {
      throw new PaymeRpcError(PAYME_ERROR.UNABLE_TO_PERFORM, "Tranzaksiyani bajarib bo'lmaydi");
    }

    const performTime = Date.now();
    await tx.paymentProviderTransaction.update({
      where: { id: transaction.id },
      data: { state: PAYME_STATE.PERFORMED, performTime: BigInt(performTime) },
    });
    const payment = await tx.payment.findUniqueOrThrow({
      where: { id: transaction.paymentId },
    });
    if (payment.status !== "PAID" && payment.status !== "REFUNDED") {
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: "PAID",
          paidAt: new Date(performTime),
          provider: PaymentProvider.PAYME,
          externalRef: externalId,
          failureReason: null,
        },
      });
    }
    await this.audit.record(tx, {
      tenantId,
      actorType: "INTEGRATION",
      action: "payment.payme_transaction_performed",
      entityType: "Payment",
      entityId: payment.id,
      metadata: { externalId, performTime },
    });

    await this.notifications.enqueue({
      tenantId,
      type: "payment.paid",
      dedupeKey: `payment__${payment.id}__paid`,
      occurredAt: new Date(performTime).toISOString(),
      data: { paymentId: payment.id, amount: payment.amount.toFixed(2) },
    });

    return {
      perform_time: performTime,
      transaction: payment.id,
      state: PAYME_STATE.PERFORMED,
    };
  }

  private async cancelTransaction(
    tx: TenantTx,
    tenantId: string,
    params: Record<string, unknown>,
  ) {
    const externalId = asString(params.id, 80);
    const reason = asSafeInteger(params.reason) ?? 0;
    if (!externalId) {
      throw new PaymeRpcError(PAYME_ERROR.INVALID_REQUEST, "Tranzaksiya id yo'q");
    }
    const transaction = await tx.paymentProviderTransaction.findUnique({
      where: {
        tenantId_provider_externalId: {
          tenantId,
          provider: PaymentProvider.PAYME,
          externalId,
        },
      },
    });
    if (!transaction) {
      throw new PaymeRpcError(PAYME_ERROR.TRANSACTION_NOT_FOUND, "Tranzaksiya topilmadi");
    }
    if (
      transaction.state === PAYME_STATE.CANCELLED ||
      transaction.state === PAYME_STATE.CANCELLED_AFTER_PERFORM
    ) {
      return {
        cancel_time: Number(transaction.cancelTime ?? 0),
        transaction: transaction.paymentId,
        state: transaction.state,
      };
    }

    const cancelTime = Date.now();
    const wasPerformed = transaction.state === PAYME_STATE.PERFORMED;
    const newState = wasPerformed
      ? PAYME_STATE.CANCELLED_AFTER_PERFORM
      : PAYME_STATE.CANCELLED;
    await tx.paymentProviderTransaction.update({
      where: { id: transaction.id },
      data: { state: newState, cancelTime: BigInt(cancelTime), reason },
    });

    const payment = await tx.payment.findUniqueOrThrow({
      where: { id: transaction.paymentId },
    });
    let notificationType: "payment.refunded" | null = null;

    if (wasPerformed) {
      if (payment.status !== "REFUNDED") {
        await tx.payment.update({
          where: { id: payment.id },
          data: { status: "REFUNDED", provider: PaymentProvider.PAYME },
        });
      }
      const existingRefund = await tx.paymentRefund.findFirst({
        where: {
          paymentId: payment.id,
          provider: PaymentProvider.PAYME,
          externalRef: externalId,
        },
      });
      if (!existingRefund) {
        await tx.paymentRefund.create({
          data: {
            tenantId,
            paymentId: payment.id,
            amount: payment.amount,
            reason: `Payme bekor qildi (sabab ${reason})`,
            status: RefundStatus.PROCESSED,
            provider: PaymentProvider.PAYME,
            externalRef: externalId,
            processedAt: new Date(cancelTime),
          },
        });
      }
      notificationType = "payment.refunded";
    } else if (payment.status === "PENDING") {
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: "CANCELLED", provider: PaymentProvider.PAYME },
      });
    }

    await this.audit.record(tx, {
      tenantId,
      actorType: "INTEGRATION",
      action: "payment.payme_transaction_cancelled",
      entityType: "Payment",
      entityId: payment.id,
      metadata: { externalId, reason, wasPerformed, newState },
    });

    if (notificationType) {
      await this.notifications.enqueue({
        tenantId,
        type: notificationType,
        dedupeKey: `payment__${payment.id}__refunded__${externalId}`,
        occurredAt: new Date(cancelTime).toISOString(),
        data: { paymentId: payment.id, amount: payment.amount.toFixed(2) },
      });
    }

    return {
      cancel_time: cancelTime,
      transaction: payment.id,
      state: newState,
    };
  }

  private async checkTransaction(tx: TenantTx, params: Record<string, unknown>) {
    const externalId = asString(params.id, 80);
    if (!externalId) {
      throw new PaymeRpcError(PAYME_ERROR.INVALID_REQUEST, "Tranzaksiya id yo'q");
    }
    const transaction = await tx.paymentProviderTransaction.findFirst({
      where: { provider: PaymentProvider.PAYME, externalId },
    });
    if (!transaction) {
      throw new PaymeRpcError(PAYME_ERROR.TRANSACTION_NOT_FOUND, "Tranzaksiya topilmadi");
    }
    const timeoutMs =
      this.config.get<number>("PAYME_TIMEOUT_MINUTES", 720) * 60_000;
    if (
      transaction.state === PAYME_STATE.CREATED &&
      Date.now() - Number(transaction.createTime) > timeoutMs
    ) {
      const cancelTime = Date.now();
      await tx.paymentProviderTransaction.update({
        where: { id: transaction.id },
        data: {
          state: PAYME_STATE.CANCELLED,
          cancelTime: BigInt(cancelTime),
          reason: 4,
        },
      });
      await tx.payment.updateMany({
        where: { id: transaction.paymentId, status: "PENDING" },
        data: { status: "CANCELLED" },
      });
      return {
        create_time: Number(transaction.createTime),
        perform_time: 0,
        cancel_time: cancelTime,
        transaction: transaction.paymentId,
        state: PAYME_STATE.CANCELLED,
        reason: 4,
      };
    }
    return {
      create_time: Number(transaction.createTime),
      perform_time: Number(transaction.performTime ?? 0),
      cancel_time: Number(transaction.cancelTime ?? 0),
      transaction: transaction.paymentId,
      state: transaction.state,
      reason: transaction.reason ?? 0,
    };
  }

  private async getStatement(tx: TenantTx, params: Record<string, unknown>) {
    const from = asSafeInteger(params.from);
    const to = asSafeInteger(params.to);
    if (from === null || to === null || from > to) {
      throw new PaymeRpcError(PAYME_ERROR.INVALID_REQUEST, "Davr noto'g'ri");
    }
    const items = await tx.paymentProviderTransaction.findMany({
      where: {
        provider: PaymentProvider.PAYME,
        createTime: { gte: BigInt(from), lte: BigInt(to) },
      },
      orderBy: { createTime: "asc" },
      take: 10_000,
    });
    return {
      transactions: items.map((item) => ({
        id: item.externalId,
        time: Number(item.createTime),
        amount: Number(item.amountTiyin),
        account: { order_id: item.paymentId },
        create_time: Number(item.createTime),
        perform_time: Number(item.performTime ?? 0),
        cancel_time: Number(item.cancelTime ?? 0),
        transaction: item.paymentId,
        state: item.state,
        reason: item.reason ?? 0,
      })),
    };
  }

  // -------------------------------------------------------------------------
  // Checkout, refunds and reconciliation
  // -------------------------------------------------------------------------

  async createCheckoutLink(actor: AuthenticatedUser, paymentId: string, ip: string | null) {
    return this.tenantPrisma.withTenant(actor.tenantId, async (tx) => {
      const payment = await tx.payment.findFirst({ where: { id: paymentId } });
      if (!payment) throw new NotFoundException("To'lov topilmadi");
      if (payment.status !== "PENDING") {
        throw new BadRequestException("Faqat kutilayotgan to'lov uchun havola yaratiladi");
      }
      const account = await tx.paymentProviderAccount.findUnique({
        where: {
          tenantId_provider: { tenantId: actor.tenantId, provider: PaymentProvider.PAYME },
        },
      });
      if (!account || !account.isActive) {
        throw new BadRequestException("Payme provayderi sozlanmagan");
      }
      const amountTiyin = Math.round(Number(payment.amount.toString()) * 100);
      const returnUrl = `${this.config
        .getOrThrow<string>("APP_ORIGIN")
        .replace(/\/$/, "")}/uz/payments`;
      const raw = [
        `m=${account.merchantId}`,
        `ac.order_id=${payment.id}`,
        `a=${amountTiyin}`,
        "l=uz",
        `c=${returnUrl}`,
      ].join(";");
      const url = `${this.config
        .getOrThrow<string>("PAYME_CHECKOUT_URL")
        .replace(/\/$/, "")}/${Buffer.from(raw, "utf8").toString("base64")}`;

      await tx.payment.update({
        where: { id: payment.id },
        data: { method: "AUTOMATIC", provider: PaymentProvider.PAYME },
      });
      await this.audit.record(tx, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: "payment.checkout_link_created",
        entityType: "Payment",
        entityId: payment.id,
        metadata: { amountTiyin, merchantId: account.merchantId },
        ip,
      });
      return { url, paymentId: payment.id, amountTiyin, provider: "PAYME" };
    });
  }

  async requestRefund(
    actor: AuthenticatedUser,
    paymentId: string,
    dto: RefundPaymentDto,
    ip: string | null,
  ) {
    const amount = money(dto.amount);
    if (amount.lte(0)) throw new BadRequestException("Summa noldan katta bo'lishi kerak");

    const outcome = await this.tenantPrisma.withTenant(actor.tenantId, async (tx) => {
      const payment = await tx.payment.findFirst({ where: { id: paymentId } });
      if (!payment) throw new NotFoundException("To'lov topilmadi");
      if (payment.status !== "PAID") {
        throw new BadRequestException("Faqat to'langan to'lovni qaytarish mumkin");
      }
      if (amount.gt(payment.amount)) {
        throw new BadRequestException("Qaytarish summasi to'lovdan katta");
      }
      const refunded = await tx.paymentRefund.aggregate({
        where: { paymentId, status: RefundStatus.PROCESSED },
        _sum: { amount: true },
      });
      if (refunded._sum.amount && amount.plus(refunded._sum.amount).gt(payment.amount)) {
        throw new BadRequestException("Qaytarishlar jami to'lovdan oshib ketadi");
      }

      const isPayme = payment.provider === PaymentProvider.PAYME;
      if (isPayme && amount.lt(payment.amount)) {
        throw new BadRequestException(
          "Payme orqali qismiy qaytarish qo'llab-quvvatlanmaydi; to'liq summani qaytaring",
        );
      }

      const status = isPayme ? RefundStatus.PROVIDER_PENDING : RefundStatus.PROCESSED;
      const refund = await tx.paymentRefund.create({
        data: {
          tenantId: actor.tenantId,
          paymentId: payment.id,
          requestedById: actor.userId,
          amount,
          reason: dto.reason.trim(),
          status,
          ...(isPayme ? { provider: PaymentProvider.PAYME } : {}),
          ...(isPayme ? {} : { processedAt: new Date() }),
        },
      });

      if (!isPayme && amount.eq(payment.amount)) {
        await tx.payment.update({
          where: { id: payment.id },
          data: { status: "REFUNDED" },
        });
      }
      await this.audit.record(tx, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: "payment.refund_requested",
        entityType: "PaymentRefund",
        entityId: refund.id,
        metadata: { paymentId, amount: amount.toFixed(2), provider: payment.provider ?? "OFFLINE" },
        ip,
      });
      return { refund, completedLocally: !isPayme };
    });

    if (outcome.completedLocally) {
      await this.notifications.enqueue({
        tenantId: actor.tenantId,
        type: "payment.refunded",
        dedupeKey: `refund__${outcome.refund.id}__processed`,
        occurredAt: new Date().toISOString(),
        data: { paymentId, amount: amount.toFixed(2) },
      });
    }

    return {
      refund: {
        ...outcome.refund,
        amount: outcome.refund.amount.toFixed(2),
      },
      instructions: outcome.completedLocally
        ? "Qaytarish tizimda qayd etildi."
        : "Payme kabinetida tranzaksiyani bekor qiling. Payme CancelTransaction yuborganda qaytarish avtomatik yakunlanadi.",
    };
  }

  async completeRefund(
    actor: AuthenticatedUser,
    refundId: string,
    dto: CompleteRefundDto,
    ip: string | null,
  ) {
    const outcome = await this.tenantPrisma.withTenant(actor.tenantId, async (tx) => {
      const refund = await tx.paymentRefund.findFirst({ where: { id: refundId } });
      if (!refund) throw new NotFoundException("Qaytarish so'rovi topilmadi");
      if (refund.status === RefundStatus.PROCESSED) {
        return { refund, alreadyProcessed: true, paymentId: refund.paymentId };
      }
      const updated = await tx.paymentRefund.update({
        where: { id: refund.id },
        data: {
          status: RefundStatus.PROCESSED,
          processedAt: new Date(),
          ...(dto.externalRef ? { externalRef: dto.externalRef.trim() } : {}),
        },
      });
      const payment = await tx.payment.findFirstOrThrow({
        where: { id: refund.paymentId },
      });
      const totalRefunded = await tx.paymentRefund.aggregate({
        where: { paymentId: payment.id, status: RefundStatus.PROCESSED },
        _sum: { amount: true },
      });
      if (
        totalRefunded._sum.amount &&
        totalRefunded._sum.amount.gte(payment.amount) &&
        payment.status !== "REFUNDED"
      ) {
        await tx.payment.update({
          where: { id: payment.id },
          data: { status: "REFUNDED" },
        });
      }
      await this.audit.record(tx, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: "payment.refund_completed",
        entityType: "PaymentRefund",
        entityId: updated.id,
        metadata: { paymentId: payment.id, externalRef: dto.externalRef ?? null },
        ip,
      });
      return { refund: updated, alreadyProcessed: false, paymentId: payment.id };
    });

    if (!outcome.alreadyProcessed) {
      await this.notifications.enqueue({
        tenantId: actor.tenantId,
        type: "payment.refunded",
        dedupeKey: `refund__${outcome.refund.id}__completed`,
        occurredAt: new Date().toISOString(),
        data: { paymentId: outcome.paymentId, amount: outcome.refund.amount.toFixed(2) },
      });
    }
    return {
      refund: { ...outcome.refund, amount: outcome.refund.amount.toFixed(2) },
      alreadyProcessed: outcome.alreadyProcessed,
    };
  }

  async listRefunds(tenantId: string) {
    return this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const items = await tx.paymentRefund.findMany({
        orderBy: { createdAt: "desc" },
        take: 100,
        include: {
          payment: {
            select: {
              amount: true,
              contract: {
                select: { vehicle: { select: { plateNumber: true } } },
              },
            },
          },
        },
      });
      return {
        items: items.map((refund) => ({
          ...refund,
          amount: refund.amount.toFixed(2),
          paymentAmount: refund.payment.amount.toFixed(2),
          plateNumber: refund.payment.contract.vehicle.plateNumber,
        })),
      };
    });
  }

  async listReconciliation(tenantId: string) {
    return this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const items = await tx.paymentReconciliation.findMany({
        orderBy: { createdAt: "desc" },
        take: 30,
      });
      return {
        items: items.map((run) => ({
          ...run,
          difference: run.difference.toFixed(2),
        })),
      };
    });
  }

  async runReconciliation(
    tenantId: string,
    provider: PaymentProvider,
    period: { from: Date; to: Date },
    actorUserId: string | null = null,
  ) {
    if (period.from >= period.to) {
      throw new BadRequestException("Davr noto'g'ri");
    }
    if (period.to.getTime() - period.from.getTime() > 31 * 24 * 60 * 60 * 1000) {
      throw new BadRequestException("Reconciliation davri 31 kundan oshmasligi kerak");
    }

    const run = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.paymentReconciliation.create({
        data: {
          tenantId,
          provider,
          periodStart: period.from,
          periodEnd: period.to,
          status: "RUNNING",
        },
      }),
    );

    try {
      const result = await this.tenantPrisma.withTenant(tenantId, async (tx) => {
        const providerTransactions = await tx.paymentProviderTransaction.findMany({
          where: {
            provider,
            createTime: {
              gte: BigInt(period.from.getTime()),
              lte: BigInt(period.to.getTime()),
            },
          },
          include: { payment: true },
        });
        const localPayments = await tx.payment.findMany({
          where: {
            provider,
            status: { in: ["PAID", "REFUNDED"] },
            paidAt: { gte: period.from, lte: period.to },
          },
        });

        const details: Prisma.InputJsonValue[] = [];
        let matched = 0;
        let missingLocal = 0;
        let amountMismatch = 0;
        let providerTotal = new Prisma.Decimal(0);
        let localTotal = new Prisma.Decimal(0);
        const performed = providerTransactions.filter(
          (item) => item.state === PAYME_STATE.PERFORMED,
        );

        for (const transaction of performed) {
          providerTotal = providerTotal.plus(transaction.payment.amount);
          if (transaction.payment.status !== "PAID" && transaction.payment.status !== "REFUNDED") {
            missingLocal += 1;
            details.push({
              type: "MISSING_LOCAL",
              paymentId: transaction.paymentId,
              externalId: transaction.externalId,
              localStatus: transaction.payment.status,
            });
          } else if (Number(transaction.amountTiyin) !== Math.round(Number(transaction.payment.amount.toString()) * 100)) {
            amountMismatch += 1;
            details.push({
              type: "AMOUNT_MISMATCH",
              paymentId: transaction.paymentId,
              externalId: transaction.externalId,
              providerTiyin: transaction.amountTiyin.toString(),
              localAmount: transaction.payment.amount.toFixed(2),
            });
          } else {
            matched += 1;
          }
        }

        let missingRemote = 0;
        for (const payment of localPayments) {
          localTotal = localTotal.plus(payment.amount);
          if (payment.status === "REFUNDED") continue;
          const hasPerformed = performed.some((item) => item.paymentId === payment.id);
          if (!hasPerformed) {
            missingRemote += 1;
            details.push({
              type: "MISSING_PROVIDER",
              paymentId: payment.id,
              amount: payment.amount.toFixed(2),
              paidAt: payment.paidAt?.toISOString() ?? null,
            });
          }
        }

        const checked = new Set<string>();
        performed.forEach((item) => checked.add(item.paymentId));
        localPayments.forEach((payment) => checked.add(payment.id));

        return {
          checkedCount: checked.size,
          matchedCount: matched,
          missingLocalCount: missingLocal,
          missingRemoteCount: missingRemote,
          amountMismatchCount: amountMismatch,
          difference: providerTotal.minus(localTotal),
          details,
        };
      });

      const completed = await this.tenantPrisma.withTenant(tenantId, (tx) =>
        tx.paymentReconciliation.update({
          where: { id: run.id },
          data: {
            status: "COMPLETED",
            checkedCount: result.checkedCount,
            matchedCount: result.matchedCount,
            missingLocalCount: result.missingLocalCount,
            missingRemoteCount: result.missingRemoteCount,
            amountMismatchCount: result.amountMismatchCount,
            difference: result.difference,
            details: result.details.slice(0, 200),
            finishedAt: new Date(),
          },
        }),
      );
      await this.tenantPrisma.withTenant(tenantId, (tx) =>
        this.audit.record(tx, {
          tenantId,
          actorUserId,
          actorType: actorUserId ? "USER" : "SYSTEM",
          action: "payment.reconciliation_completed",
          entityType: "PaymentReconciliation",
          entityId: run.id,
          metadata: {
            provider,
            checked: result.checkedCount,
            missingLocal: result.missingLocalCount,
            missingRemote: result.missingRemoteCount,
            difference: result.difference.toFixed(2),
          },
        }),
      );
      return { ...completed, difference: completed.difference.toFixed(2) };
    } catch (error) {
      await this.tenantPrisma.withTenant(tenantId, (tx) =>
        tx.paymentReconciliation.update({
          where: { id: run.id },
          data: {
            status: "FAILED",
            error: (error instanceof Error ? error.message : String(error)).slice(0, 500),
            finishedAt: new Date(),
          },
        }),
      );
      throw error;
    }
  }

  async runReconciliationForAllTenants(period: { from: Date; to: Date }) {
    const tenantIds = await this.tenantPrisma.listActiveTenantIds();
    const results: Array<{ tenantId: string; status: string }> = [];
    for (const tenantId of tenantIds) {
      const hasAccount = await this.tenantPrisma.withTenant(tenantId, async (tx) =>
        Boolean(
          await tx.paymentProviderAccount.findFirst({
            where: { provider: PaymentProvider.PAYME, isActive: true },
          }),
        ),
      );
      if (!hasAccount) {
        results.push({ tenantId, status: "skipped_no_provider" });
        continue;
      }
      try {
        await this.runReconciliation(tenantId, PaymentProvider.PAYME, period);
        results.push({ tenantId, status: "completed" });
      } catch (error) {
        this.logger.error(
          `Reconciliation tenant=${tenantId} failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        results.push({ tenantId, status: "failed" });
      }
    }
    return { tenants: tenantIds.length, results };
  }

  private jsonSafe(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(
      JSON.stringify(value, (_key, item) =>
        typeof item === "bigint" ? item.toString() : item,
      ),
    ) as Prisma.InputJsonValue;
  }
}

export class PaymeRpcError extends Error {
  constructor(
    public readonly code: number,
    message: string,
  ) {
    super(message);
  }
}
