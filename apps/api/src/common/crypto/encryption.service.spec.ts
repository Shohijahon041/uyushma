import { ConfigService } from "@nestjs/config";
import { EncryptionService } from "./encryption.service";

function service(key = "unit-test-encryption-key-0123456789abcdef"): EncryptionService {
  return new EncryptionService(new ConfigService({ APP_ENCRYPTION_KEY: key }));
}

describe("EncryptionService", () => {
  it("ma'lumotni shifrlaydi va qayta ochadi", () => {
    const encryption = service();
    const secret = "Payme:super-secret-key";
    const payload = encryption.encrypt(secret);

    expect(payload.startsWith("v1.")).toBe(true);
    expect(payload).not.toContain(secret);
    expect(encryption.decrypt(payload)).toBe(secret);
  });

  it("har safar yangi IV ishlatadi", () => {
    const encryption = service();
    expect(encryption.encrypt("same")).not.toBe(encryption.encrypt("same"));
  });

  it("o'zgartirilgan shifrmatnni rad etadi", () => {
    const encryption = service();
    const payload = encryption.encrypt("secret-value");
    const parts = payload.split(".");
    const data = Buffer.from(parts[3]!, "base64url");
    data[0] = data[0]! ^ 0xff;
    const tampered = [parts[0], parts[1], parts[2], data.toString("base64url")].join(".");

    expect(() => encryption.decrypt(tampered)).toThrow();
    expect(() => encryption.decrypt("not-a-payload")).toThrow();
  });

  it("boshqa kalit bilan ochilmaydi", () => {
    const first = service("key-one-0123456789abcdef0123456789abcdef");
    const second = service("key-two-0123456789abcdef0123456789abcdef");
    expect(() => second.decrypt(first.encrypt("value"))).toThrow();
  });

  it("HMAC deterministik va kontekstga bog'liq", () => {
    const encryption = service();
    const a = encryption.hmac("ABC-DEF", "recovery:user-1");
    const b = encryption.hmac("ABC-DEF", "recovery:user-1");
    const c = encryption.hmac("ABC-DEF", "recovery:user-2");

    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(encryption.safeEqualHex(a, b)).toBe(true);
    expect(encryption.safeEqualHex(a, c)).toBe(false);
    expect(encryption.safeEqualHex(a, "zz")).toBe(false);
  });

  it("qisqa kalitni rad etadi", () => {
    expect(() => service("short")).toThrow(/kamida 32/);
  });
});
