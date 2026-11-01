import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { ExternalProvider } from "@prisma/client";
import type { AuthenticatedUser } from "../../../common/auth/auth.types";
import { ExternalService } from "../external.service";
import {
  extractOneIdCode,
  type OneIdConnectAllDto,
  type OneIdConnectAllResult,
} from "../external.types";

export const ONEID_SSO_URLS: Record<ExternalProvider, string> = {
  ETENDER:
    "https://sso.egov.uz/sso/oauth/Authorization.do?response_type=one_code&client_id=e-tender_uztrans_uz&redirect_uri=https://e-tender.uztrans.uz&scope=e-tender_uztrans_uz&state=e-tender_uztrans_uz",
  AUTOPARK:
    "https://sso.egov.uz/sso/oauth/Authorization.do?response_type=one_code&client_id=bm_dtransport_uz&redirect_uri=https://bm.dtransport.uz/login/oneid&scope=myportal&state=testState",
  IJARA: "https://ijara.soliq.uz",
};

@Injectable()
export class OneIdAuthService {
  private readonly logger = new Logger(OneIdAuthService.name);

  constructor(private readonly externalService: ExternalService) {}

  /**
   * Rasmiy OneID OAuth2 SSO tizimiga yo'naltiruvchi havolalarni qaytaradi
   */
  getSsoUrls(): Record<ExternalProvider, string> {
    return ONEID_SSO_URLS;
  }

  /**
   * Foydalanuvchi OneID SSO orqali kirgandan keyin qaytgan kod yoki
   * URL manzilini (`one_code` yoki `code`) tegishli portal uchun haqiqiy
   * Bearer tokenga aylantiradi va ulanishni saqlaydi.
   */
  async exchangeCode(
    actor: AuthenticatedUser,
    provider: ExternalProvider,
    rawCodeOrUrl: string,
    ip: string | null,
  ) {
    const code = extractOneIdCode(rawCodeOrUrl);
    if (!code || code.length < 3) {
      throw new BadRequestException("OneID kodi yoki URL manzili noto'g'ri kiritildi");
    }

    const res = await this.externalService.saveConnection(
      actor,
      provider,
      {
        credentials: {
          username: "oneid_sso",
          code,
        },
      },
      ip,
    );

    void this.externalService.syncConnection(actor.tenantId, provider, actor.userId, ip).catch((err) => {
      this.logger.warn(`${provider} sinxronizatsiya navbatiga qo'shilmadi: ${String(err)}`);
    });

    return {
      success: true,
      provider,
      account: res.account,
    };
  }

  /**
   * Bitta OneID login va paroli yoki OneID kodi bilan tizimlarga ulanish
   */
  async connectAll(
    actor: AuthenticatedUser,
    dto: OneIdConnectAllDto,
    ip: string | null,
  ): Promise<OneIdConnectAllResult> {
    const results: OneIdConnectAllResult["providers"] = {
      ETENDER: { success: false },
      AUTOPARK: { success: false },
      IJARA: { success: false },
    };

    let anySuccess = false;

    // 1. Agar OneID kodi berilgan bo'lsa
    if (dto.code?.trim()) {
      const code = extractOneIdCode(dto.code);
      // E-tender uchun sinaymiz
      try {
        const res = await this.exchangeCode(actor, "ETENDER", code, ip);
        results.ETENDER = { success: true, account: res.account };
        anySuccess = true;
      } catch (err) {
        // Agar e-tender qabul qilmasa, avtopark uchun sinab ko'ramiz
        try {
          const res = await this.exchangeCode(actor, "AUTOPARK", code, ip);
          results.AUTOPARK = { success: true, account: res.account };
          anySuccess = true;
        } catch {
          results.ETENDER = {
            success: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }
    }

    // 2. e-tender.uztrans.uz ulanishi (agar login/parol kiritilgan bo'lsa)
    if (dto.username?.trim() && dto.password?.trim()) {
      try {
        const res = await this.externalService.saveConnection(
          actor,
          "ETENDER",
          {
            credentials: {
              username: dto.username.trim(),
              password: dto.password,
              ...(dto.ip?.trim() ? { ip: dto.ip.trim() } : {}),
            },
          },
          ip,
        );
        results.ETENDER = {
          success: true,
          account: res.account,
        };
        anySuccess = true;

        void this.externalService.syncConnection(actor.tenantId, "ETENDER", actor.userId, ip).catch((err) => {
          this.logger.warn(`ETENDER sinxronizatsiya navbatiga qo'shilmadi: ${String(err)}`);
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`OneID ETENDER ulanish xatosi: ${message}`);
        results.ETENDER = {
          success: false,
          error: message,
        };
      }

      // 3. bm.dtransport.uz ulanishi
      try {
        const res = await this.externalService.saveConnection(
          actor,
          "AUTOPARK",
          {
            credentials: {
              username: dto.username.trim(),
              password: dto.password,
            },
          },
          ip,
        );
        results.AUTOPARK = {
          success: true,
          account: res.account,
        };
        anySuccess = true;

        void this.externalService.syncConnection(actor.tenantId, "AUTOPARK", actor.userId, ip).catch((err) => {
          this.logger.warn(`AUTOPARK sinxronizatsiya navbatiga qo'shilmadi: ${String(err)}`);
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`OneID AUTOPARK ulanish xatosi: ${message}`);
        results.AUTOPARK = {
          success: false,
          error: message,
        };
      }
    }

    // 4. ijara.soliq.uz tekshiruvi:
    try {
      const existingList = await this.externalService.listConnections(actor.tenantId);
      const ijaraConn = existingList.items.find((item) => item.provider === "IJARA");

      if (ijaraConn && ijaraConn.status === "ACTIVE") {
        results.IJARA = {
          success: true,
          account: ijaraConn.account ?? "Faol Soliq sessiyasi",
        };
        anySuccess = true;

        void this.externalService.syncConnection(actor.tenantId, "IJARA", actor.userId, ip).catch((err) => {
          this.logger.warn(`IJARA sinxronizatsiya navbatiga qo'shilmadi: ${String(err)}`);
        });
      } else {
        results.IJARA = {
          success: false,
          error: "ijara.soliq.uz E-IMZO elektron kaliti yoki sessiya tokeni orqali ulanadi (pastdagi 'E-IMZO bilan kirish' tugmasidan foydalaning)",
        };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.IJARA = {
        success: false,
        error: `ijara.soliq.uz holatini tekshirib bo'lmadi: ${message}`,
      };
    }

    return {
      overallSuccess: anySuccess,
      providers: results,
    };
  }
}
