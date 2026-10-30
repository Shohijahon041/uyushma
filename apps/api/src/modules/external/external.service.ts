import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  Prisma,
  type ExternalConnection,
  type ExternalProvider,
  type ExternalRecordKind,
} from "@prisma/client";
import type { AuthenticatedUser } from "../../common/auth/auth.types";
import { EncryptionService } from "../../common/crypto/encryption.service";
import { TenantPrismaService, type TenantTx } from "../../common/prisma/tenant-prisma.service";
import { AuditService } from "../audit/audit.service";
import { AutoparkConnector } from "./connectors/autopark.connector";
import { EtenderConnector } from "./connectors/etender.connector";
import { isExternalAuthError } from "./connectors/http";
import {
  PROVIDER_LABELS,
  type ExternalConnector,
  type ExternalFetchResult,
  type NormalizedRecord,
  type NormalizedVehicle,
  type ProviderConfig,
  type ProviderCredentials,
} from "./external.types";
import { ExternalSyncQueueService } from "./external.queue";
import { collectRouteDistances, parseRouteName, seatCount } from "./native-import";

function jsonValue(value: unknown): Prisma.InputJsonValue {
  if (value === null || value === undefined) return {};
  try {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  } catch {
    return {};
  }
}

function routeKey(name: string): string {
  return name.replace(/\s+/g, " ").trim().slice(0, 160).toLowerCase();
}

function normalizePlate(plate: string | null): string {
  return (plate ?? "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

function publicConnection(connection: ExternalConnection) {
  const config = (connection.config ?? {}) as ProviderConfig;
  return {
    id: connection.id,
    provider: connection.provider,
    label: PROVIDER_LABELS[connection.provider],
    baseUrl: connection.baseUrl,
    status: connection.status,
    account: config.account ?? null,
    authMode: connection.credentialsEncrypted ? "LOGIN" : "TOKEN",
    lastSyncAt: connection.lastSyncAt,
    lastLoginAt: connection.lastLoginAt,
    lastError: connection.lastError,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

@Injectable()
export class ExternalService {
  private readonly logger = new Logger(ExternalService.name);
  private readonly connectors: Map<ExternalProvider, ExternalConnector>;

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
    private readonly encryption: EncryptionService,
    private readonly queue: ExternalSyncQueueService,
  ) {
    const etender = new EtenderConnector();
    const autopark = new AutoparkConnector();
    this.connectors = new Map<ExternalProvider, ExternalConnector>([
      [etender.provider, etender],
      [autopark.provider, autopark],
    ]);
  }

  private connector(provider: ExternalProvider): ExternalConnector {
    const connector = this.connectors.get(provider);
    if (!connector) throw new BadRequestException("Noma'lum provayder");
    return connector;
  }

  async listConnections(tenantId: string) {
    const items = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.externalConnection.findMany({ orderBy: { provider: "asc" } }),
    );
    return { items: items.map(publicConnection), labels: PROVIDER_LABELS };
  }

  async saveConnection(
    actor: AuthenticatedUser,
    provider: ExternalProvider,
    dto: {
      token?: string;
      credentials?: ProviderCredentials;
      baseUrl?: string;
      config?: Record<string, unknown>;
    },
    ip: string | null,
  ) {
    const connector = this.connector(provider);
    const baseUrl = (dto.baseUrl ?? connector.defaultBaseUrl).replace(/\/+$/, "");
    if (!baseUrl.startsWith("https://")) {
      throw new BadRequestException("Manzil https:// bilan boshlanishi kerak");
    }
    const config = (dto.config ?? {}) as ProviderConfig;
    const credentials: ProviderCredentials | null = dto.credentials
      ? {
          username: dto.credentials.username.trim(),
          password: dto.credentials.password,
          ...(dto.credentials.ip?.trim() ? { ip: dto.credentials.ip.trim() } : {}),
        }
      : null;
    if (credentials && !credentials.username) {
      throw new BadRequestException("Login bo'sh bo'lmasligi kerak");
    }
    const rawToken = (dto.token?.trim() ?? "").replace(/^Bearer\s+/i, "");
    if (!credentials && !rawToken) {
      throw new BadRequestException("Token yoki login/parol kiritilishi kerak");
    }

    let token = rawToken;
    let account: string | null = null;
    let lastLoginAt: Date | null = null;
    if (credentials) {
      if (!connector.login) {
        throw new BadRequestException("Bu provayder login usulini qo'llab-quvvatlamaydi");
      }
      try {
        const login = await connector.login(baseUrl, credentials, config);
        token = login.token;
        account = login.account;
        lastLoginAt = new Date();
      } catch (error) {
        throw new BadRequestException(
          `Avtomatik kirish amalga oshmadi: ${errorText(error)}`,
        );
      }
      try {
        const probe = await connector.test(baseUrl, token);
        account = probe.account ?? account;
      } catch (error) {
        if (isExternalAuthError(error)) {
          throw new BadRequestException(
            `Login amalga oshdi, lekin token tekshiruvdan o'tmadi: ${errorText(error)}`,
          );
        }
      }
    } else {
      try {
        const probe = await connector.test(baseUrl, token);
        account = probe.account;
      } catch (error) {
        throw new BadRequestException(
          `Ulanish tekshiruvi muvaffaqiyatsiz: ${errorText(error)}`,
        );
      }
    }

    const tokenEncrypted = this.encryption.encrypt(token);
    const credentialsEncrypted = credentials
      ? this.encryption.encrypt(JSON.stringify(credentials))
      : null;
    const connection = await this.tenantPrisma.withTenant(actor.tenantId, async (tx) => {
      const saved = await tx.externalConnection.upsert({
        where: {
          tenantId_provider: { tenantId: actor.tenantId, provider },
        },
        create: {
          tenantId: actor.tenantId,
          provider,
          baseUrl,
          tokenEncrypted,
          credentialsEncrypted,
          config: dto.config ? jsonValue(dto.config) : undefined,
          status: "ACTIVE",
          lastLoginAt,
        },
        update: {
          baseUrl,
          tokenEncrypted,
          credentialsEncrypted,
          config: dto.config ? jsonValue(dto.config) : undefined,
          status: "ACTIVE",
          lastLoginAt,
          lastError: null,
        },
      });
      await this.audit.record(tx, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: "external.connection.saved",
        entityType: "ExternalConnection",
        entityId: saved.id,
        metadata: {
          provider,
          baseUrl,
          authMode: credentials ? "LOGIN" : "TOKEN",
        },
        ip,
      });
      return saved;
    });

    return { connection: publicConnection(connection), account };
  }

  async disableConnection(
    actor: AuthenticatedUser,
    provider: ExternalProvider,
    ip: string | null,
  ) {
    const connection = await this.tenantPrisma.withTenant(actor.tenantId, async (tx) => {
      const existing = await tx.externalConnection.findUnique({
        where: { tenantId_provider: { tenantId: actor.tenantId, provider } },
      });
      if (!existing) throw new NotFoundException("Ulanish topilmadi");
      const updated = await tx.externalConnection.update({
        where: { id: existing.id },
        data: {
          status: "DISABLED",
          credentialsEncrypted: null,
          lastLoginAt: null,
        },
      });
      await this.audit.record(tx, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: "external.connection.disabled",
        entityType: "ExternalConnection",
        entityId: updated.id,
        metadata: { provider },
        ip,
      });
      return updated;
    });
    return { connection: publicConnection(connection) };
  }

  async enqueueSync(
    tenantId: string,
    provider: ExternalProvider | undefined,
  ): Promise<{ queued: ExternalProvider[] }> {
    const connections = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.externalConnection.findMany({
        where: {
          status: "ACTIVE",
          ...(provider ? { provider } : {}),
        },
        select: { provider: true },
      }),
    );
    if (connections.length === 0) {
      throw new NotFoundException("Faol ulanish topilmadi");
    }
    for (const connection of connections) {
      await this.queue.enqueueSync(tenantId, connection.provider);
    }
    return { queued: connections.map((connection) => connection.provider) };
  }

  async syncConnection(
    tenantId: string,
    provider: ExternalProvider,
  ): Promise<{ counts: Record<string, number>; warnings: string[] }> {
    const connection = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.externalConnection.findUnique({
        where: { tenantId_provider: { tenantId, provider } },
      }),
    );
    if (!connection) throw new NotFoundException("Ulanish topilmadi");
    if (connection.status === "DISABLED") {
      throw new BadRequestException("Ulanish o'chirilgan");
    }

    const connector = this.connector(provider);
    let token = this.encryption.decrypt(connection.tokenEncrypted);
    const config = (connection.config ?? {}) as ProviderConfig;
    const credentials = this.credentialsOf(connection);
    let loginError: unknown = null;

    // With stored credentials every run starts from a fresh session, so an
    // expired token never blocks the 6-hourly sync.
    if (credentials && connector.login) {
      try {
        const login = await connector.login(connection.baseUrl, credentials, config);
        token = login.token;
        await this.tenantPrisma.withTenant(tenantId, (tx) =>
          tx.externalConnection.update({
            where: { id: connection.id },
            data: {
              tokenEncrypted: this.encryption.encrypt(token),
              lastLoginAt: new Date(),
            },
          }),
        );
      } catch (error) {
        loginError = error;
      }
    }

    const run = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.externalSyncRun.create({
        data: {
          tenantId,
          connectionId: connection.id,
          provider,
          status: "RUNNING",
        },
      }),
    );

    try {
      const result = await connector.fetchAll(connection.baseUrl, token, config);
      const counts = await this.persist(tenantId, provider, result);
      const warning = result.warnings.length
        ? result.warnings.join(" | ").slice(0, 500)
        : null;
      const account =
        result.vehicles.find((vehicle) => vehicle.organizationName)?.organizationName ?? null;

      await this.tenantPrisma.withTenant(tenantId, async (tx) => {
        await tx.externalSyncRun.update({
          where: { id: run.id },
          data: { status: "SUCCESS", finishedAt: new Date(), counts },
        });
        await tx.externalConnection.update({
          where: { id: connection.id },
          data: {
            lastSyncAt: new Date(),
            lastError: warning,
            status: "ACTIVE",
            config: account ? jsonValue({ ...config, account }) : undefined,
          },
        });
        await this.audit.record(tx, {
          tenantId,
          actorType: "INTEGRATION",
          action: "external.sync.completed",
          entityType: "ExternalConnection",
          entityId: connection.id,
          metadata: { provider, ...counts },
        });
      });

      this.logger.log(
        `Sync ${provider} tenant=${tenantId}: ${JSON.stringify(counts)}`,
      );
      return { counts, warnings: result.warnings };
    } catch (error) {
      const baseMessage = errorText(error);
      const message = (
        loginError && isExternalAuthError(error)
          ? `Avtomatik kirish: ${errorText(loginError)} | ${baseMessage}`
          : baseMessage
      ).slice(0, 1000);
      const authError =
        isExternalAuthError(error) ||
        (loginError !== null && isExternalAuthError(loginError));
      await this.tenantPrisma
        .withTenant(tenantId, async (tx) => {
          await tx.externalSyncRun.update({
            where: { id: run.id },
            data: { status: "FAILED", finishedAt: new Date(), error: message },
          });
          await tx.externalConnection.update({
            where: { id: connection.id },
            data: {
              lastError: message.slice(0, 500),
              status: authError ? "INVALID" : undefined,
            },
          });
        })
        .catch(() => undefined);
      this.logger.warn(`Sync ${provider} tenant=${tenantId} failed: ${message}`);
      throw new BadGatewayException(message);
    }
  }

  private credentialsOf(connection: ExternalConnection): ProviderCredentials | null {
    if (!connection.credentialsEncrypted) return null;
    try {
      const parsed = JSON.parse(
        this.encryption.decrypt(connection.credentialsEncrypted),
      ) as Partial<ProviderCredentials>;
      if (
        typeof parsed.username === "string" &&
        typeof parsed.password === "string"
      ) {
        return {
          username: parsed.username,
          password: parsed.password,
          ...(typeof parsed.ip === "string" ? { ip: parsed.ip } : {}),
        };
      }
    } catch {
      this.logger.warn(
        `External credentials decrypt failed provider=${connection.provider}`,
      );
    }
    return null;
  }

  private async persist(
    tenantId: string,
    provider: ExternalProvider,
    result: ExternalFetchResult,
  ): Promise<Record<string, number>> {
    return this.tenantPrisma.withTenant(
      tenantId,
      async (tx) => {
        const owner = await tx.user.findFirst({
          where: { isActive: true, role: { in: ["OWNER", "ADMIN"] } },
          orderBy: [{ role: "asc" }, { createdAt: "asc" }],
          select: { id: true },
        });
        const routes = await this.importRoutes(tx, tenantId, result);
        const routeRows = await tx.route.findMany({ select: { id: true, name: true } });
        const routeByName = new Map(
          routeRows.map((route) => [routeKey(route.name), route.id]),
        );
        const routeIdFor = (name: string | null) =>
          name ? routeByName.get(routeKey(name)) ?? null : null;
        const nativeVehicles = await tx.vehicle.findMany({
          select: { id: true, plateNumber: true, capacity: true, routeId: true },
        });
        const byPlate = new Map(
          nativeVehicles.map((vehicle) => [
            normalizePlate(vehicle.plateNumber),
            vehicle.id,
          ]),
        );
        const nativeById = new Map(nativeVehicles.map((vehicle) => [vehicle.id, vehicle]));

        let matched = 0;
        let created = 0;
        for (const vehicle of result.vehicles) {
          const plateKey = normalizePlate(vehicle.plateNumber);
          let vehicleId = plateKey ? byPlate.get(plateKey) ?? null : null;
          // The company fleet lives in e-tender; mirror it as a native vehicle so
          // contracts, tariffs and the dashboard work off the same records.
          if (!vehicleId && plateKey && owner) {
            const native = await tx.vehicle.create({
              data: {
                tenantId,
                ownerId: owner.id,
                plateNumber: vehicle.plateNumber!.trim().slice(0, 20),
                model: (vehicle.vehicleModel ?? "Ko'rsatilmagan").trim().slice(0, 120),
                capacity: seatCount(vehicle.raw),
                routeId: routeIdFor(vehicle.routeName),
                status: "ACTIVE",
              },
            });
            vehicleId = native.id;
            byPlate.set(plateKey, native.id);
            created += 1;
          } else if (vehicleId) {
            // Only empty fields are filled; manual edits are never overwritten.
            const native = nativeById.get(vehicleId);
            const capacity = seatCount(vehicle.raw);
            const routeId = routeIdFor(vehicle.routeName);
            const patch = {
              ...(native && native.capacity === 0 && capacity > 0 ? { capacity } : {}),
              ...(native && !native.routeId && routeId ? { routeId } : {}),
            };
            if (Object.keys(patch).length > 0) {
              await tx.vehicle.update({ where: { id: vehicleId }, data: patch });
            }
          }
          if (vehicleId) matched += 1;
          await this.upsertVehicle(tx, tenantId, provider, vehicle, vehicleId);
        }
        for (const record of result.records) {
          await this.upsertRecord(tx, tenantId, provider, record);
        }

        return {
          vehicles: result.vehicles.length,
          matched,
          created,
          routes,
          records: result.records.length,
          warnings: result.warnings.length,
        };
      },
      { timeoutMs: 240_000 },
    );
  }

  /**
   * Directions operated by the company become native routes so tariffs can be
   * scoped per route. Distance comes from contract/appeal payloads when the
   * provider reports it; otherwise 0 (the UI marks it as unknown).
   */
  private async importRoutes(
    tx: TenantTx,
    tenantId: string,
    result: ExternalFetchResult,
  ): Promise<number> {
    const names = new Map<string, string>();
    const add = (value: string | null) => {
      if (!value) return;
      const name = value.replace(/\s+/g, " ").trim().slice(0, 160);
      if (name.length < 3 || /^(-+|—|n\/?a|yo'q|нет)$/i.test(name)) return;
      const key = name.toLowerCase();
      if (!names.has(key)) names.set(key, name);
    };
    for (const vehicle of result.vehicles) add(vehicle.routeName);
    const distances = collectRouteDistances(result.records);
    for (const [key, route] of distances) {
      if (!names.has(key)) names.set(key, route.name);
    }

    const existing = await tx.route.findMany({ select: { name: true } });
    const known = new Set(existing.map((route) => route.name.toLowerCase()));

    let created = 0;
    for (const [key, name] of names) {
      if (known.has(key)) continue;
      const { origin, destination } = parseRouteName(name);
      await tx.route.create({
        data: {
          tenantId,
          name,
          origin: origin || name,
          destination: destination || "—",
          distanceKm: distances.get(key)?.distance ?? 0,
        },
      });
      known.add(key);
      created += 1;
    }
    return created;
  }

  private async upsertVehicle(
    tx: TenantTx,
    tenantId: string,
    provider: ExternalProvider,
    vehicle: NormalizedVehicle,
    vehicleId: string | null,
  ): Promise<void> {
    const data = {
      plateNumber: vehicle.plateNumber,
      garageNumber: vehicle.garageNumber,
      vin: vehicle.vin,
      gpsImei: vehicle.gpsImei,
      organizationName: vehicle.organizationName,
      routeName: vehicle.routeName,
      routeNumber: vehicle.routeNumber,
      vehicleClass: vehicle.vehicleClass,
      vehicleModel: vehicle.vehicleModel,
      drivers: vehicle.drivers == null ? Prisma.DbNull : jsonValue(vehicle.drivers),
      licenseNumber: vehicle.licenseNumber,
      licenseExpiresAt: vehicle.licenseExpiresAt,
      vehicleId,
      raw: jsonValue(vehicle.raw),
      syncedAt: new Date(),
    };
    await tx.externalVehicle.upsert({
      where: {
        tenantId_provider_externalId: {
          tenantId,
          provider,
          externalId: vehicle.externalId,
        },
      },
      create: {
        tenantId,
        provider,
        externalId: vehicle.externalId,
        ...data,
      },
      update: data,
    });
  }

  private async upsertRecord(
    tx: TenantTx,
    tenantId: string,
    provider: ExternalProvider,
    record: NormalizedRecord,
  ): Promise<void> {
    const data = {
      number: record.number,
      title: record.title,
      status: record.status,
      startsAt: record.startsAt,
      endsAt: record.endsAt,
      issuedAt: record.issuedAt,
      expiresAt: record.expiresAt,
      raw: jsonValue(record.raw),
      syncedAt: new Date(),
    };
    await tx.externalRecord.upsert({
      where: {
        tenantId_provider_kind_externalId: {
          tenantId,
          provider,
          kind: record.kind,
          externalId: record.externalId,
        },
      },
      create: {
        tenantId,
        provider,
        kind: record.kind,
        externalId: record.externalId,
        ...data,
      },
      update: data,
    });
  }

  async listVehicles(
    tenantId: string,
    query: { provider?: ExternalProvider; search?: string; limit?: number },
  ) {
    const where: Prisma.ExternalVehicleWhereInput = {};
    if (query.provider) where.provider = query.provider;
    if (query.search) {
      where.OR = [
        { plateNumber: { contains: query.search, mode: "insensitive" } },
        { garageNumber: { contains: query.search, mode: "insensitive" } },
        { vin: { contains: query.search, mode: "insensitive" } },
        { organizationName: { contains: query.search, mode: "insensitive" } },
      ];
    }
    const items = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.externalVehicle.findMany({
        where,
        take: query.limit ?? 200,
        orderBy: [{ provider: "asc" }, { plateNumber: "asc" }],
        include: { vehicle: { select: { id: true, status: true } } },
      }),
    );
    return { items };
  }

  async listRecords(
    tenantId: string,
    query: { kind: ExternalRecordKind; provider?: ExternalProvider; limit?: number },
  ) {
    const items = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.externalRecord.findMany({
        where: {
          kind: query.kind,
          ...(query.provider ? { provider: query.provider } : {}),
        },
        take: query.limit ?? 200,
        orderBy: [{ syncedAt: "desc" }, { externalId: "asc" }],
      }),
    );
    return { items };
  }

  async listRuns(tenantId: string, limit = 20) {
    const items = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.externalSyncRun.findMany({
        take: limit,
        orderBy: { startedAt: "desc" },
      }),
    );
    return { items };
  }

  async syncAll(): Promise<{ synced: number; items: unknown[] }> {
    const tenantIds = await this.tenantPrisma.listActiveTenantIds();
    const items: unknown[] = [];
    for (const tenantId of tenantIds) {
      const connections = await this.tenantPrisma.withTenant(tenantId, (tx) =>
        tx.externalConnection.findMany({
          where: { status: { in: ["ACTIVE", "INVALID"] } },
          select: { provider: true, status: true, credentialsEncrypted: true },
        }),
      );
      for (const connection of connections) {
        // A login-based connection can recover on its own: every run starts
        // with a fresh session. Token-only connections still need a human.
        if (connection.status === "INVALID" && !connection.credentialsEncrypted) {
          continue;
        }
        try {
          const result = await this.syncConnection(tenantId, connection.provider);
          items.push({
            tenantId,
            provider: connection.provider,
            ok: true,
            counts: result.counts,
          });
        } catch (error) {
          items.push({
            tenantId,
            provider: connection.provider,
            ok: false,
            error: errorText(error),
          });
        }
      }
    }
    return { synced: items.length, items };
  }

}
