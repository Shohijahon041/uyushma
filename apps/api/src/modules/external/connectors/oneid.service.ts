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
    const results: OneIdConnectAllResult["providers"] = {
      ETENDER: { success: false },
      AUTOPARK: { success: false },
      IJARA: { success: false },
    };

    let anySuccess = false;

    // 1. e-tender.uztrans.uz ulanishi (One ID orqali)
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

      void this.externalService.syncConnection(actor.tenantId, "ETENDER").catch((err) => {
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

    // 2. bm.dtransport.uz ulanishi (One ID / avtopark orqali)
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

      void this.externalService.syncConnection(actor.tenantId, "AUTOPARK").catch((err) => {
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

    // 3. ijara.soliq.uz tekshiruvi:
    // Soliq tizimi E-IMZO yoki sessiya tokeni orqali autentifikatsiyani talab qiladi.
    // Agar foydalanuvchida allaqachon faol Soliq ulanishi bo'lsa, uni saqlaymiz.
    try {
      const existingList = await this.externalService.listConnections(actor.tenantId);
      const ijaraConn = existingList.items.find((item) => item.provider === "IJARA");

      if (ijaraConn && ijaraConn.status === "ACTIVE") {
        results.IJARA = {
          success: true,
          account: ijaraConn.account ?? "Faol Soliq sessiyasi",
        };
        anySuccess = true;

        void this.externalService.syncConnection(actor.tenantId, "IJARA").catch((err) => {
          this.logger.warn(`IJARA sinxronizatsiya navbatiga qo'shilmadi: ${String(err)}`);
        });
      } else {
        // Soliqqa OneID login/paroli bilan to'g'ridan-to'g'ri ulanib bo'lmaydi,
        // foydalanuvchiga aniq tushunarli ko'rsatma beramiz
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
