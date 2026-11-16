import { Injectable, Logger } from "@nestjs/common";
import { ExternalProvider } from "@prisma/client";
import { OneIdBrowserService } from "./oneid-browser.service";
import { OneIdAuthService } from "./oneid.service";
import { ExternalService } from "../external.service";
import { TenantPrismaService } from "../../../common/prisma/tenant-prisma.service";

import type { AuthenticatedUser } from "../../../common/auth/auth.types";

@Injectable()
export class OneIdAutomatedTokenService {
  private readonly logger = new Logger(OneIdAutomatedTokenService.name);

  constructor(
    private readonly browserService: OneIdBrowserService,
    private readonly oneIdAuth: OneIdAuthService,
    private readonly externalService: ExternalService,
    private readonly tenantPrisma: TenantPrismaService,
  ) {}

  /**
   * OneID login va paroli orqali avtomatik login qilib, tokenni yangilaydi
   */
  async renewToken(
    tenantId: string,
    provider: ExternalProvider,
    username: string,
    password: string,
  ): Promise<{ success: boolean; token?: string; error?: string }> {
    this.logger.log(`OneID avtomatik yangilash boshlanmoqda: tenant=${tenantId} provider=${provider}`);

    const browserRes = await this.browserService.loginAutomated(
      provider,
      username,
      password,
    );

    if (!browserRes.success || !browserRes.code) {
      this.logger.warn(`OneID kirish amalga oshmadi: ${browserRes.error}`);
      return {
        success: false,
        error: browserRes.error ?? "OneID orqali kod olinmadi",
      };
    }

    try {
      const actor: AuthenticatedUser = {
        userId: "system-token-daemon",
        tenantId,
        role: "OWNER",
        phone: null,
        fullName: "System Token Daemon",
        isSuperAdmin: false,
      };

      const res = await this.oneIdAuth.exchangeCode(
        actor,
        provider,
        browserRes.code,
        "127.0.0.1",
      );

      this.logger.log(`OneID muvaffaqiyatli yangilandi provider=${provider}`);
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Token almashtirishda xatolik: ${msg}`);
      return { success: false, error: msg };
    }
  }
}
