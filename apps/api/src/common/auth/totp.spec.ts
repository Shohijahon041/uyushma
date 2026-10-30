import {
  base32Decode,
  base32Encode,
  generateRecoveryCodes,
  generateTotpSecret,
  normalizeRecoveryCode,
  totpCode,
  totpUri,
  verifyTotp,
} from "./totp";

// RFC 6238 ilovasidagi SHA1 test siri (ASCII "12345678901234567890").
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("TOTP", () => {
  it("RFC 6238 vektoriga mos 6 xonali kod beradi", () => {
    expect(totpCode(RFC_SECRET, 59_000)).toBe("287082");
    expect(totpCode(RFC_SECRET, 1_111_111_109_000)).toBe("081804");
  });

  it("joriy va qo'shni qadamdagi kodni qabul qiladi, uzoq kodni rad etadi", () => {
    const now = 1_700_000_000_000;
    const current = totpCode(RFC_SECRET, now);
    const previous = totpCode(RFC_SECRET, now - 30_000);
    const far = totpCode(RFC_SECRET, now - 5 * 30_000);

    expect(verifyTotp(RFC_SECRET, current, { timestampMs: now })).toBe(true);
    expect(verifyTotp(RFC_SECRET, previous, { timestampMs: now })).toBe(true);
    expect(verifyTotp(RFC_SECRET, far, { timestampMs: now })).toBe(false);
  });

  it("bo'shliqlar bilan yozilgan kodni qabul qiladi, noto'g'ri formatni rad etadi", () => {
    const now = 1_700_000_000_000;
    const code = totpCode(RFC_SECRET, now);
    const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;

    expect(verifyTotp(RFC_SECRET, spaced, { timestampMs: now })).toBe(true);
    expect(verifyTotp(RFC_SECRET, "12345", { timestampMs: now })).toBe(false);
    expect(verifyTotp(RFC_SECRET, "abcdef", { timestampMs: now })).toBe(false);
  });

  it("base32 kodlash/dekodlash aylanishi ma'lumotni saqlaydi", () => {
    const buffer = Buffer.from("uyushmachilar-secret", "utf8");
    expect(base32Decode(base32Encode(buffer)).equals(buffer)).toBe(true);
  });

  it("sir va otpauth URI kutilgan formatda bo'ladi", () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);

    const uri = new URL(totpUri(secret, "owner@example.com"));
    expect(uri.protocol).toBe("otpauth:");
    expect(uri.searchParams.get("secret")).toBe(secret);
    expect(uri.searchParams.get("period")).toBe("30");
    expect(uri.searchParams.get("digits")).toBe("6");
  });

  it("tiklash kodlari unikal, guruhlangan va normallashtiriladi", () => {
    const codes = generateRecoveryCodes(8);
    expect(new Set(codes).size).toBe(8);
    for (const code of codes) {
      expect(code).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
      expect(normalizeRecoveryCode(code.toLowerCase())).toHaveLength(10);
    }
  });
});
