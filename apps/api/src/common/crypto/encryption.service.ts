import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const VERSION = "v1";

/**
 * AES-256-GCM envelope for provider secrets and TOTP seeds. The key is derived
 * from APP_ENCRYPTION_KEY; ciphertext carries its own IV and auth tag so key
 * rotation can add a new version prefix later.
 */
@Injectable()
export class EncryptionService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    const raw = config.getOrThrow<string>("APP_ENCRYPTION_KEY");
    this.key = EncryptionService.parseKey(raw);
  }

  private static parseKey(raw: string): Buffer {
    if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, "hex");
    try {
      const decoded = Buffer.from(raw, "base64");
      if (decoded.length === 32) return decoded;
    } catch {
      // fall through to hashing
    }
    if (raw.length < 32) {
      throw new Error("APP_ENCRYPTION_KEY kamida 32 belgi bo'lishi kerak");
    }
    return Buffer.from(
      createHmac("sha256", "uyushmachilar-envelope")
        .update(raw)
        .digest(),
    );
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return [
      VERSION,
      iv.toString("base64url"),
      tag.toString("base64url"),
      ciphertext.toString("base64url"),
    ].join(".");
  }

  decrypt(payload: string): string {
    if (!payload || typeof payload !== "string") return "";
    const parts = payload.split(".");
    if (parts.length !== 4 || parts[0] !== VERSION) {
      throw new Error("Shifrlangan ma'lumot formati noto'g'ri");
    }
    const ivPart = parts[1];
    const tagPart = parts[2];
    const dataPart = parts[3];
    if (!ivPart || !tagPart || !dataPart) {
      throw new Error("Shifrlangan ma'lumot to'liq emas");
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      Buffer.from(ivPart, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataPart, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  }

  /** Deterministic HMAC used for recovery codes and one-time token lookups. */
  hmac(value: string, context = "generic"): string {
    return createHmac("sha256", this.key)
      .update(`${context}:${value}`)
      .digest("hex");
  }

  safeEqualHex(a: string, b: string): boolean {
    if (!/^[0-9a-f]+$/i.test(a) || !/^[0-9a-f]+$/i.test(b)) return false;
    const left = Buffer.from(a, "hex");
    const right = Buffer.from(b, "hex");
    if (left.length !== right.length) return false;
    return timingSafeEqual(left, right);
  }
}
