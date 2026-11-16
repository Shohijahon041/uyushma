import { Injectable, Logger } from "@nestjs/common";
import { ExternalService } from "./external.service";
import { TenantPrismaService } from "../../common/prisma/tenant-prisma.service";

@Injectable()
export class TokenWatchdogService {
  private readonly logger = new Logger(TokenWatchdogService.name);
  private isRunning = false;

  constructor(
    private readonly externalService: ExternalService,
    private readonly tenantPrisma: TenantPrismaService,
  ) {}

  /**
   * Har 30 daqiqada tokenlarni tekshirib, sinxronlashni ishga tushiradi
   */
  async checkAndRenewAll(): Promise<{ synced: number; durationMs: number }> {
    if (this.isRunning) {
      this.logger.warn("Token watchdog allaqachon ishlamoqda, o'tkazib yuborildi.");
      return { synced: 0, durationMs: 0 };
    }

    this.isRunning = true;
    const start = Date.now();
    this.logger.log("Token Watchdog tekshiruvi boshlandi...");

    try {
      const res = await this.externalService.syncAll();
      const durationMs = Date.now() - start;
      this.logger.log(`Token Watchdog yakunlandi: synced=${res.synced} duration=${durationMs}ms`);
      return { synced: res.synced, durationMs };
    } catch (err) {
      this.logger.error(`Token Watchdog xatosi: ${String(err)}`);
      return { synced: 0, durationMs: Date.now() - start };
    } finally {
      this.isRunning = false;
    }
  }
}

