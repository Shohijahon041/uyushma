import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function base32Decode(input: string): Buffer {
  const cleaned = input.toUpperCase().replace(/[=\s-]/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of cleaned) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error("TOTP sirida yaroqsiz belgi");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateTotpSecret(bytes = 20): string {
  return base32Encode(randomBytes(bytes));
}

export function totpCode(secret: string, timestampMs = Date.now(), stepSeconds = 30): string {
  const counter = Math.floor(timestampMs / 1000 / stepSeconds);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", base32Decode(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

/** Accepts the current step plus one step of clock drift in either direction. */
export function verifyTotp(
  secret: string,
  code: string,
  options: { timestampMs?: number; window?: number; stepSeconds?: number } = {},
): boolean {
  const value = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(value)) return false;
  const now = options.timestampMs ?? Date.now();
  const window = options.window ?? 1;
  const stepSeconds = options.stepSeconds ?? 30;
  const provided = Buffer.from(value);
  for (let offset = -window; offset <= window; offset += 1) {
    const candidate = Buffer.from(
      totpCode(secret, now + offset * stepSeconds * 1000, stepSeconds),
    );
    if (candidate.length === provided.length && timingSafeEqual(candidate, provided)) {
      return true;
    }
  }
  return false;
}

export function totpUri(secret: string, account: string, issuer = "Uyushmachilar"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30",
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

export function generateRecoveryCodes(count = 8): string[] {
  const codes: string[] = [];
  for (let index = 0; index < count; index += 1) {
    let raw = "";
    for (let char = 0; char < 10; char += 1) {
      raw += RECOVERY_ALPHABET[randomBytes(1)[0]! % RECOVERY_ALPHABET.length];
    }
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5)}`);
  }
  return codes;
}

export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}
