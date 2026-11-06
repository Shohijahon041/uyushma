import { Injectable } from "@nestjs/common";
import { randomInt } from "node:crypto";
import type { ExternalProvider } from "@prisma/client";
import type { AuthenticatedUser } from "../../common/auth/auth.types";

export const LOCAL_CONNECTOR_PORTALS: Record<ExternalProvider, string> = {
  ETENDER: "https://e-tender.uztrans.uz",
  AUTOPARK: "https://bm.dtransport.uz",
  IJARA: "https://ijara.soliq.uz/login",
};

export interface PairingEntry {
  actor: AuthenticatedUser;
  provider: ExternalProvider;
  expiresAt: number;
}

const PAIRING_TTL_MS = 10 * 60_000;

@Injectable()
export class LocalConnectorService {
  private readonly codes = new Map<string, PairingEntry>();

  issue(actor: AuthenticatedUser, provider: ExternalProvider) {
    this.prune();
    let code = "";
    do {
      code = randomInt(100_000, 1_000_000).toString();
    } while (this.codes.has(code));

    const expiresAt = Date.now() + PAIRING_TTL_MS;
    this.codes.set(code, { actor, provider, expiresAt });
    return {
      code,
      expiresAt: new Date(expiresAt).toISOString(),
      portalUrl: LOCAL_CONNECTOR_PORTALS[provider],
    };
  }

  peek(code: string): PairingEntry | null {
    const entry = this.codes.get(code.trim());
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      this.codes.delete(code.trim());
      return null;
    }
    return entry;
  }

  consume(code: string): PairingEntry | null {
    const entry = this.peek(code);
    if (!entry) return null;
    this.codes.delete(code.trim());
    return entry;
  }

  private prune() {
    const now = Date.now();
    for (const [code, entry] of this.codes) {
      if (entry.expiresAt < now) this.codes.delete(code);
    }
  }
}
