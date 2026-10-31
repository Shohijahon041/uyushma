import { Injectable, Logger } from "@nestjs/common";
import { ExternalProvider } from "@prisma/client";
import type { AuthenticatedUser } from "../../../common/auth/auth.types";
import { ExternalService } from "../external.service";
import {
  type OneIdConnectAllDto,
  type OneIdConnectAllResult,
} from "../external.types";

@Injectable()
export class OneIdAuthService {
  private readonly logger = new Logger(OneIdAuthService.name);

  constructor(private readonly externalService: ExternalService) {}

  /**
   * Bitta OneID login va paroli bilan uchala tizimga (bm.dtransport.uz,
   * e-tender.uztrans.uz, ijara.soliq.uz) ulanishni avtomatlashtiradi.
   */
  async connectAll(
    actor: AuthenticatedUser,
    dto: OneIdConnectAllDto,
    ip: string | null,
  ): Promise<OneIdConnectAllResult> {
    const providers: ExternalProvider[] = ["ETENDER", "AUTOPARK", "IJARA"];
    const results: OneIdConnectAllResult["providers"] = {
      ETENDER: { success: false },
      AUTOPARK: { success: false },
      IJARA: { success: false },
    };

    let anySuccess = false;

    for (const provider of providers) {
      try {
        const res = await this.externalService.saveConnection(
          actor,
          provider,
          {
            credentials: {
              username: dto.username.trim(),
              password: dto.password,
              ...(provider === "ETENDER" && dto.ip ? { ip: dto.ip } : {}),
            },
          },
          ip,
        );
        results[provider] = {
          success: true,
          account: res.account,
        };
        anySuccess = true;

        // Ulanish muvaffaqiyatli bo'lsa, navbatga sinxronizatsiyani qo'shish
        void this.externalService.syncConnection(actor.tenantId, provider).catch((err) => {
          this.logger.warn(`${provider} sinxronizatsiya navbatiga qo'shilmadi: ${String(err)}`);
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`OneID ${provider} ulanish xatosi: ${message}`);
        results[provider] = {
          success: false,
          error: message,
        };
      }
    }

    return {
      overallSuccess: anySuccess,
      providers: results,
    };
  }
}
