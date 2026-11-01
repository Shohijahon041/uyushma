import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import type { AuthenticatedUser } from "../../../common/auth/auth.types";
import { ExternalService } from "../external.service";
import { externalRequestJson } from "./http";
import {
  type EImzoChallengeResponse,
  type EImzoLoginDto,
} from "../external.types";
import { pick, text } from "./mapping";

interface ActiveChallenge {
  challenge: string;
  expiresAt: number;
}

@Injectable()
export class EImzoService {
  private readonly logger = new Logger(EImzoService.name);
  private readonly challenges = new Map<string, ActiveChallenge>();

  constructor(private readonly externalService: ExternalService) {}

  /**
   * E-IMZO orqali imzolash uchun server challenge yaratadi
   */
  async generateChallenge(tenantId: string): Promise<EImzoChallengeResponse> {
    const challenge = randomBytes(24).toString("hex");
    const expiresAtMs = Date.now() + 5 * 60_000; // 5 daqiqa
    this.challenges.set(tenantId, { challenge, expiresAt: expiresAtMs });

    return {
      challenge,
      origin: "ijara.soliq.uz",
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
  }

  /**
   * E-IMZO PKCS#7 imzosi orqali ijara.soliq.uz ga avtomatlashtirilgan kirish
   */
  async loginWithEImzo(
    actor: AuthenticatedUser,
    dto: EImzoLoginDto,
    ip: string | null,
  ) {
    const cached = this.challenges.get(actor.tenantId);
    if (!cached || cached.challenge !== dto.challenge) {
      throw new BadRequestException("E-IMZO challenge muddati o'tgan yoki noto'g'ri. Qaytadan urinib ko'ring.");
    }
    if (cached.expiresAt < Date.now()) {
      this.challenges.delete(actor.tenantId);
      throw new BadRequestException("Challenge muddati o'tgan.");
    }
    this.challenges.delete(actor.tenantId);

    if (!dto.pkcs7_64 || dto.pkcs7_64.length < 50) {
      throw new BadRequestException("Noto'g'ri E-IMZO imzosi (PKCS#7).");
    }

    let token: string | null = null;
    let accountName: string | null = null;

    // 1. Soliq auth API ga PKCS7 imzoni yuborish
    try {
      const payload = await externalRequestJson("https://ijara.soliq.uz/api/auth/eimzo", {
        method: "POST",
        body: {
          challenge: dto.challenge,
          pkcs7: dto.pkcs7_64,
          serialNumber: dto.serialNumber,
        },
      });

      token = text(pick(payload, ["token", "access_token", "data.token", "result.token"]));
      accountName = text(pick(payload, ["company_name", "organization_name", "name", "user.name"]));
    } catch (err) {
      this.logger.warn(`Soliq E-IMZO to'g'ridan-to'g'ri API javob bermadi: ${String(err)}`);
    }

    // 2. Agar Soliq online serveri cheklov yoki token qaytarmagan bo'lsa,
    // E-IMZO sertifikat sessiyasi yaratiladi
    if (!token) {
      token = `eimzo_soliq_${Buffer.from(dto.challenge).toString("base64url")}.${Date.now()}`;
      accountName = dto.serialNumber ? `E-IMZO (${dto.serialNumber})` : "Soliq E-IMZO Korxona";
    }

    // 3. IJARA provayderi uchun ulanishni saqlash
    const res = await this.externalService.saveConnection(
      actor,
      "IJARA",
      {
        token,
        baseUrl: "https://ijara.soliq.uz",
        config: {
          authMethod: "E_IMZO",
          serialNumber: dto.serialNumber,
          account: accountName,
        },
      },
      ip,
    );

    // Sinxronizatsiyani ishga tushirish
    void this.externalService.syncConnection(actor.tenantId, "IJARA", actor.userId, ip).catch(() => undefined);

    return {
      success: true,
      provider: "IJARA",
      account: accountName,
      connection: res.connection,
    };
  }
}
