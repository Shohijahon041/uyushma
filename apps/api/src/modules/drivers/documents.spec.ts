import { normalizeDocumentValue, parseHumanDate } from "./documents";

describe("driver documents", () => {
  it("normalizes passport and license numbers", () => {
    expect(normalizeDocumentValue("passportNumber", "aa 1234567")).toBe("AA1234567");
    expect(normalizeDocumentValue("passportNumber", "АА1234567")).toBe("AA1234567");
    expect(normalizeDocumentValue("licenseNumber", "af1234567")).toBe("AF1234567");
    expect(() => normalizeDocumentValue("passportNumber", "A123")).toThrow();
  });

  it("parses human dates and rejects future past-only dates", () => {
    expect(parseHumanDate("25.03.2020")?.toISOString()).toBe("2020-03-25T00:00:00.000Z");
    expect(parseHumanDate("2020-03-25")?.toISOString()).toBe("2020-03-25T00:00:00.000Z");
    expect(parseHumanDate("31.02.2020")).toBeNull();
    expect(() => normalizeDocumentValue("birthDate", "01.01.2999")).toThrow();
    expect(normalizeDocumentValue("licenseExpiresAt", "01.01.2030")).toBeInstanceOf(Date);
  });

  it("validates pinfl and categories, clears on empty", () => {
    expect(normalizeDocumentValue("pinfl", "3010 1990 1234 56")).toBe("30101990123456");
    expect(() => normalizeDocumentValue("pinfl", "123")).toThrow();
    expect(normalizeDocumentValue("licenseCategories", "b, c,В d")).toBe("B, C, D");
    expect(() => normalizeDocumentValue("licenseCategories", "Z")).toThrow();
    expect(normalizeDocumentValue("passportNumber", "")).toBeNull();
    expect(normalizeDocumentValue("licenseNumber", "-")).toBeNull();
  });
});
