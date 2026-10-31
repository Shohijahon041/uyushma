import { FraudDetectorService } from "./fraud-detector.service";

describe("FraudDetectorService", () => {
  let service: FraudDetectorService;

  beforeEach(() => {
    service = new FraudDetectorService();
  });

  it("soxta redaktor belgilari bo'lmagan toza rasm uchun LOW xavf qaytaradi", async () => {
    // 50 KB haqiqiy JPEG baytlari
    const cleanBuffer = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]),
      Buffer.alloc(50_000, 0x20),
      Buffer.from([0xff, 0xd9]),
    ]);

    const txMock = {
      paymentSubmission: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    } as any;

    const result = await service.analyzeReceipt(txMock, cleanBuffer, {
      tenantId: "tenant-1",
      driverId: "driver-1",
      amount: "50000.00",
    });

    expect(result.risk).toBe("LOW");
    expect(result.score).toBe(0);
    expect(result.flags.length).toBe(0);
    expect(result.imageHash).toBeDefined();
    expect(result.analysis.magicMime).toBe("image/jpeg");
  });

  it("Photoshop yoki grafik redaktor belgilari bo'lgan rasmni aniqlaydi va HIGH xavf beradi", async () => {
    // Photoshop signature qo'shilgan 50 KB dummy rasm
    const photoshopString = "Photoshop 3.0 8BIM Adobe Photoshop 2024";
    const editedBuffer = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe1]),
      Buffer.from(photoshopString, "utf8"),
      Buffer.alloc(50_000, 0x20),
      Buffer.from([0xff, 0xd9]),
    ]);

    const txMock = {
      paymentSubmission: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    } as any;

    const result = await service.analyzeReceipt(txMock, editedBuffer, {
      tenantId: "tenant-1",
      driverId: "driver-1",
      amount: "150000.00",
    });

    expect(result.flags).toContain("SOFTWARE_EDITING_DETECTED");
    expect(result.analysis.detectedSoftware).toContain("Photoshop");
    expect(result.analysis.detectedSoftware).toContain("Adobe");
    expect(result.score).toBeGreaterThanOrEqual(50);
  });

  it("avval ishlatilgan bir xil chek rasmini (duplikat SHA-256) aniqlaydi", async () => {
    const buffer = Buffer.alloc(20_000, 0x11);

    const txMock = {
      paymentSubmission: {
        findFirst: jest.fn().mockResolvedValue({
          id: "sub-old-123",
          status: "APPROVED",
          driver: { fullName: "Ali Valiyev" },
          vehicle: { plateNumber: "01A123BC" },
        }),
      },
    } as any;

    const result = await service.analyzeReceipt(txMock, buffer, {
      tenantId: "tenant-1",
      driverId: "driver-1",
      amount: "70000.00",
    });

    expect(result.risk).toBe("HIGH");
    expect(result.flags).toContain("DUPLICATE_IMAGE_HASH");
    expect(result.analysis.isDuplicateHash).toBe(true);
    expect(result.analysis.details.some((d) => d.includes("Ali Valiyev"))).toBe(true);
  });

  it("takroriy tranzaksiya raqamini aniqlaydi", async () => {
    const buffer = Buffer.alloc(20_000, 0x22);

    const txMock = {
      paymentSubmission: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(null) // hash check passed
          .mockResolvedValueOnce({
            id: "sub-tx-456",
            status: "APPROVED",
          }), // transactionNumber check duplicate found
      },
    } as any;

    const result = await service.analyzeReceipt(txMock, buffer, {
      tenantId: "tenant-1",
      driverId: "driver-1",
      amount: "25000.00",
      transactionNumber: "TX-99887766",
    });

    expect(result.flags).toContain("DUPLICATE_TRANSACTION_NUMBER");
    expect(result.analysis.isDuplicateTransaction).toBe(true);
    expect(result.analysis.details.some((d) => d.includes("TX-99887766"))).toBe(true);
  });
});
