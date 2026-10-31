import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { PrismaService } from "./prisma.service";

export type TenantTx = Prisma.TransactionClient;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Every tenant-owned read/write must run through withTenant(). The service sets
 * `app.tenant_id` transaction-locally, so pooled connections cannot leak tenant
 * context into another request.
 */
@Injectable()
export class TenantPrismaService {
  private readonly logger = new Logger(TenantPrismaService.name);

  constructor(private readonly prisma: PrismaService) {}

  async withTenant<T>(
    tenantId: string,
    fn: (tx: TenantTx) => Promise<T>,
    options: { timeoutMs?: number } = {},
  ): Promise<T> {
    if (!UUID_RE.test(tenantId)) {
      throw new Error("Invalid tenant id");
    }
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(
          "SELECT set_config('app.tenant_id', $1::text, true)",
          tenantId,
        );
        return fn(tx);
      },
      {
        timeout: options.timeoutMs ?? 20_000,
        maxWait: 5_000,
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      },
    );
  }

  /** Pre-auth lookup for payment webhooks. Returns tenant id only. */
  async resolvePaymentTenant(paymentId: string): Promise<string | null> {
    if (!UUID_RE.test(paymentId)) return null;
    const rows = await this.prisma.$queryRaw<Array<{ id: string | null }>>`
      SELECT app_resolve_payment_tenant(${paymentId}::uuid) AS id
    `;
    return rows[0]?.id ?? null;
  }

  /** Pre-auth lookup. Returns null for unknown/suspended tenants. */
  async resolveTenantIdBySlug(slug: string): Promise<string | null> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string | null }>>`
      SELECT app_resolve_tenant_by_slug(${slug}) AS id
    `;
    return rows[0]?.id ?? null;
  }

  async resolveTenantIdByPhone(phone: string): Promise<string | null> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string | null }>>`
      SELECT app_resolve_tenant_by_phone(${phone}) AS id
    `;
    return rows[0]?.id ?? null;
  }

  async resolveTelegramChat(
    chatId: bigint,
  ): Promise<{ tenantId: string; userId: string } | null> {
    const rows = await this.prisma.$queryRaw<
      Array<{ tenant_id: string; user_id: string }>
    >`SELECT * FROM app_resolve_telegram_chat(${chatId})`;
    const row = rows[0];
    return row ? { tenantId: row.tenant_id, userId: row.user_id } : null;
  }

  async consumeTelegramLinkToken(
    tokenHash: string,
    chatId: bigint,
    username: string | null,
  ): Promise<{ tenantId: string; userId: string } | null> {
    const rows = await this.prisma.$queryRaw<
      Array<{ tenant_id: string; user_id: string }>
    >`SELECT * FROM app_consume_telegram_link_token(${tokenHash}, ${chatId}, ${username})`;
    const row = rows[0];
    return row ? { tenantId: row.tenant_id, userId: row.user_id } : null;
  }

  /** Driver chat lookup for the Telegram bot (identifier only). */
  async resolveDriverChat(
    chatId: bigint,
  ): Promise<{ tenantId: string; driverId: string } | null> {
    const rows = await this.prisma.$queryRaw<
      Array<{ tenant_id: string; driver_id: string }>
    >`SELECT * FROM app_resolve_driver_chat(${chatId})`;
    const row = rows[0];
    return row ? { tenantId: row.tenant_id, driverId: row.driver_id } : null;
  }

  async consumeDriverLinkToken(
    tokenHash: string,
    chatId: bigint,
    username: string | null,
  ): Promise<{ tenantId: string; driverId: string } | null> {
    const rows = await this.prisma.$queryRaw<
      Array<{ tenant_id: string; driver_id: string }>
    >`SELECT * FROM app_consume_driver_link_token(${tokenHash}, ${chatId}, ${username})`;
    const row = rows[0];
    return row ? { tenantId: row.tenant_id, driverId: row.driver_id } : null;
  }

  /** Telefon raqami (Telegram kontakt orqali tasdiqlangan) bo'yicha haydovchini bog'lash. */
  async linkDriverByPhone(
    phone: string,
    chatId: bigint,
    profile: { username: string | null; firstName: string | null; lastName: string | null },
  ): Promise<
    | { status: "linked"; tenantId: string; driverId: string }
    | { status: "not_found" | "ambiguous" }
  > {
    const rows = await this.prisma.$queryRaw<
      Array<{ status: string; tenant_id: string | null; driver_id: string | null }>
    >`SELECT * FROM app_link_driver_by_phone(${phone}, ${chatId}, ${profile.username}, ${profile.firstName}, ${profile.lastName})`;
    const row = rows[0];
    if (row?.status === "linked" && row.tenant_id && row.driver_id) {
      return { status: "linked", tenantId: row.tenant_id, driverId: row.driver_id };
    }
    return { status: row?.status === "ambiguous" ? "ambiguous" : "not_found" };
  }

  /** Platform-level identifier list used only by the internal billing runner. */
  async listActiveTenantIds(): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT * FROM app_list_active_tenant_ids() AS id
    `;
    return rows.map((row) => row.id);
  }

  /** Health probe that does not expose tenant data. */
  async ping(): Promise<void> {
    await this.prisma.$queryRaw`SELECT 1`;
  }
}
