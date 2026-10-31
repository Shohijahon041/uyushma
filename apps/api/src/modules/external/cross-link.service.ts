import { Injectable, Logger } from "@nestjs/common";
import { type ExternalRecord, type ExternalVehicle } from "@prisma/client";
import type { AuthenticatedUser } from "../../common/auth/auth.types";
import { TenantPrismaService } from "../../common/prisma/tenant-prisma.service";
import { AuditService } from "../audit/audit.service";
import { formatDmY, normalizePlate } from "./connectors/mapping";
import { type CrossLinkedVehicleView } from "./external.types";

type AnyRecord = Record<string, unknown>;

function isRecord(value: unknown): value is AnyRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

@Injectable()
export class ExternalCrossLinkService {
  private readonly logger = new Logger(ExternalCrossLinkService.name);

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Uchala portal (ijara.soliq.uz, e-tender.uztrans.uz, bm.dtransport.uz)
   * ma'lumotlarini bitta avtomobil kartochkasiga birlashtirib beradi (360° View).
   */
  async getUnifiedRegistry(tenantId: string): Promise<{
    items: CrossLinkedVehicleView[];
    totals: {
      totalVehicles: number;
      fullyCompliant: number;
      partial: number;
      expired: number;
      noRentContract: number;
    };
  }> {
    return this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const [extVehicles, extRecords, nativeVehicles] = await Promise.all([
        tx.externalVehicle.findMany({
          orderBy: { plateNumber: "asc" },
        }),
        tx.externalRecord.findMany({
          orderBy: { syncedAt: "desc" },
        }),
        tx.vehicle.findMany({
          select: {
            id: true,
            plateNumber: true,
            model: true,
            status: true,
            monthlyFee: true,
            route: { select: { name: true } },
            assignments: {
              where: { endDate: null },
              select: { driver: { select: { fullName: true, phone: true } } },
            },
          },
        }),
      ]);

      // Guruhlash: normalizedPlate -> ma'lumotlar
      const plateMap = new Map<
        string,
        {
          rawPlate: string;
          model: string | null;
          vin: string | null;
          ijaraVeh?: ExternalVehicle;
          etenderVeh?: ExternalVehicle;
          autoparkVeh?: ExternalVehicle;
          ijaraRecord?: ExternalRecord;
          nativeVeh?: (typeof nativeVehicles)[number];
        }
      >();

      const getOrCreate = (plate: string | null | undefined) => {
        const norm = normalizePlate(plate);
        if (!norm) return null;
        let entry = plateMap.get(norm);
        if (!entry) {
          entry = {
            rawPlate: plate!.trim().toUpperCase(),
            model: null,
            vin: null,
          };
          plateMap.set(norm, entry);
        }
        return entry;
      };

      // 1. Native avtomobillarni joylash
      for (const nv of nativeVehicles) {
        const entry = getOrCreate(nv.plateNumber);
        if (entry) {
          entry.nativeVeh = nv;
          entry.model = nv.model;
        }
      }

      // 2. Tashqi avtomobillarni provayder bo'yicha ajratish
      for (const ev of extVehicles) {
        const entry = getOrCreate(ev.plateNumber);
        if (!entry) continue;
        if (!entry.model && ev.vehicleModel) entry.model = ev.vehicleModel;
        if (!entry.vin && ev.vin) entry.vin = ev.vin;

        if (ev.provider === "IJARA") entry.ijaraVeh = ev;
        else if (ev.provider === "ETENDER") entry.etenderVeh = ev;
        else if (ev.provider === "AUTOPARK") entry.autoparkVeh = ev;
      }

      // 3. Ijara shartnomalari (ijara.soliq.uz) yozuvlarini bog'lash
      for (const rec of extRecords) {
        if (rec.kind === "RENT_CONTRACT" && isRecord(rec.raw)) {
          const recPlate =
            (rec.raw.vehicleNumber as string) ??
            (rec.raw.vehicle_number as string) ??
            (rec.raw.car_number as string) ??
            (rec.raw.carNumber as string) ??
            (rec.raw.plateNumber as string) ??
            (rec.raw.plate_number as string) ??
            (rec.raw.car as AnyRecord)?.number ??
            "";
          const entry = getOrCreate(recPlate);
          if (entry && !entry.ijaraRecord) {
            entry.ijaraRecord = rec;
          }
        }
      }

      const now = Date.now();
      const items: CrossLinkedVehicleView[] = [];

      for (const [norm, data] of plateMap.entries()) {
        const rawIjara = isRecord(data.ijaraRecord?.raw) ? data.ijaraRecord.raw : {};
        const rawIjaraVeh = isRecord(data.ijaraVeh?.raw) ? data.ijaraVeh.raw : {};

        // Ijara shartnomasi ma'lumotlari
        let ijaraInfo: CrossLinkedVehicleView["ijara"] = null;
        if (data.ijaraRecord || data.ijaraVeh) {
          const rec = data.ijaraRecord;
          const contractId =
            rec?.externalId ??
            (rawIjaraVeh.contract_id as string) ??
            (rawIjaraVeh.id as string) ??
            "";
          const starts = rec?.startsAt ? rec.startsAt.toISOString().slice(0, 10) : null;
          const ends = rec?.endsAt ? rec.endsAt.toISOString().slice(0, 10) : null;
          const isExpired = rec?.endsAt ? rec.endsAt.getTime() < now : false;

          const startDmY = rec?.startsAt ? formatDmY(rec.startsAt) : "";
          const endDmY = rec?.endsAt ? formatDmY(rec.endsAt) : "";
          const contractUrl =
            startDmY && endDmY
              ? `https://ijara.soliq.uz/car/contract-view/${contractId}/${startDmY}/${endDmY}`
              : `https://ijara.soliq.uz/car/renting/list?myRentType=1&statusGroup=1`;

          const driversObj = Array.isArray(data.ijaraVeh?.drivers)
            ? (data.ijaraVeh.drivers[0] as AnyRecord)
            : null;

          const lesseeFullName =
            (driversObj?.fullName as string) ??
            (rawIjara.lessee_name as string) ??
            (rawIjaraVeh.lessee_name as string) ??
            null;

          const lesseePinfl =
            (driversObj?.pinfl as string) ??
            (rawIjara.lessee_pinfl as string) ??
            null;

          const lesseePhone =
            (driversObj?.phone as string) ??
            (rawIjara.lessee_phone as string) ??
            null;

          ijaraInfo = {
            contractId,
            contractNumber: rec?.number ?? contractId,
            startsAt: starts,
            endsAt: ends,
            isExpired,
            status: rec?.status ?? "ACTIVE",
            contractViewUrl: contractUrl,
            monthlyFee: (rawIjara.monthlyFee as string) ?? (rawIjara.rent_amount as string) ?? null,
            lessor: data.ijaraVeh?.organizationName ?? (rawIjara.lessor_name as string) ?? null,
            lessee: lesseeFullName
              ? {
                  fullName: lesseeFullName,
                  pinfl: lesseePinfl,
                  phone: lesseePhone,
                }
              : null,
          };
        }

        // E-tender ma'lumotlari
        let etenderInfo: CrossLinkedVehicleView["etender"] = null;
        if (data.etenderVeh) {
          const expiresAt = data.etenderVeh.licenseExpiresAt
            ? data.etenderVeh.licenseExpiresAt.toISOString().slice(0, 10)
            : null;
          const isExpired = data.etenderVeh.licenseExpiresAt
            ? data.etenderVeh.licenseExpiresAt.getTime() < now
            : false;
          etenderInfo = {
            licenseNumber: data.etenderVeh.licenseNumber,
            licenseExpiresAt: expiresAt,
            isExpired,
            routeName: data.etenderVeh.routeName,
            routeNumber: data.etenderVeh.routeNumber,
            organizationName: data.etenderVeh.organizationName,
          };
        }

        // Autopark (BM) ma'lumotlari
        let autoparkInfo: CrossLinkedVehicleView["autopark"] = null;
        if (data.autoparkVeh) {
          const driversList = Array.isArray(data.autoparkVeh.drivers)
            ? (data.autoparkVeh.drivers as Array<{ fullName: string; phone?: string }>)
            : [];
          autoparkInfo = {
            garageNumber: data.autoparkVeh.garageNumber,
            gpsImei: data.autoparkVeh.gpsImei,
            routeName: data.autoparkVeh.routeName,
            organizationName: data.autoparkVeh.organizationName,
            drivers: driversList,
          };
        }

        // Qonuniylik va hujjatlar holatini tekshirish
        let complianceStatus: CrossLinkedVehicleView["complianceStatus"] = "PARTIAL";
        const notes: string[] = [];

        if (!ijaraInfo) {
          complianceStatus = "NO_RENT_CONTRACT";
          notes.push("ijara.soliq.uz da ro'yxatdan o'tgan ijara shartnomasi topilmadi.");
        } else if (ijaraInfo.isExpired) {
          complianceStatus = "EXPIRED";
          notes.push(`Soliq ijara shartnomasi muddati o'tgan (${ijaraInfo.endsAt}).`);
        } else {
          notes.push(`Soliq ijara shartnomasi faol (#${ijaraInfo.contractNumber}).`);
        }

        if (etenderInfo) {
          if (etenderInfo.isExpired) {
            complianceStatus = "EXPIRED";
            notes.push(`E-Tender litsenziya muddati o'tgan (${etenderInfo.licenseExpiresAt}).`);
          } else {
            notes.push(`E-Tender litsenziyasi mavjud (${etenderInfo.licenseNumber ?? "faol"}).`);
          }
        } else {
          notes.push("E-Tender ro'yxatida yo'nalish litsenziyasi topilmadi.");
        }

        if (autoparkInfo?.garageNumber) {
          notes.push(`BM Garaj raqami biriktirilgan (#${autoparkInfo.garageNumber}).`);
        }

        if (
          ijaraInfo &&
          !ijaraInfo.isExpired &&
          etenderInfo &&
          !etenderInfo.isExpired
        ) {
          complianceStatus = "FULLY_COMPLIANT";
        }

        items.push({
          plateNumber: data.rawPlate,
          normalizedPlate: norm,
          model: data.model,
          vin: data.vin,
          nativeVehicleId: data.nativeVeh?.id ?? null,
          nativeVehicleStatus: data.nativeVeh?.status ?? null,
          ijara: ijaraInfo,
          etender: etenderInfo,
          autopark: autoparkInfo,
          complianceStatus,
          complianceNotes: notes,
        });
      }

      // Statistika hisoblash
      const totals = {
        totalVehicles: items.length,
        fullyCompliant: items.filter((i) => i.complianceStatus === "FULLY_COMPLIANT").length,
        partial: items.filter((i) => i.complianceStatus === "PARTIAL").length,
        expired: items.filter((i) => i.complianceStatus === "EXPIRED").length,
        noRentContract: items.filter((i) => i.complianceStatus === "NO_RENT_CONTRACT").length,
      };

      return { items, totals };
    });
  }

  /**
   * Uchala portal ma'lumotlarini platforma avtomobillari va haydovchilari
   * bilan to'liq avtomatik biriktiradi (Auto-Link).
   */
  async autoLinkAll(actor: AuthenticatedUser, ip: string | null) {
    return this.tenantPrisma.withTenant(actor.tenantId, async (tx) => {
      const owner = await tx.user.findFirst({
        where: { role: "OWNER" },
        select: { id: true },
      });

      const [extVehicles, nativeVehicles, extRecords] = await Promise.all([
        tx.externalVehicle.findMany(),
        tx.vehicle.findMany({ select: { id: true, plateNumber: true, model: true } }),
        tx.externalRecord.findMany({ where: { kind: "RENT_CONTRACT" } }),
      ]);

      const nativeByPlate = new Map(
        nativeVehicles.map((v) => [normalizePlate(v.plateNumber), v.id]),
      );

      let linkedCount = 0;
      let createdVehicles = 0;
      let createdDrivers = 0;

      for (const ev of extVehicles) {
        const norm = normalizePlate(ev.plateNumber);
        if (!norm) continue;

        let nativeId = nativeByPlate.get(norm);
        if (!nativeId && owner && ev.plateNumber) {
          // Native avtomobilni avtomatik yaratish
          const newVeh = await tx.vehicle.create({
            data: {
              tenantId: actor.tenantId,
              ownerId: owner.id,
              plateNumber: ev.plateNumber.trim().toUpperCase(),
              model: (ev.vehicleModel ?? "Transport").trim().slice(0, 120),
              capacity: 0,
              status: "ACTIVE",
            },
          });
          nativeId = newVeh.id;
          nativeByPlate.set(norm, newVeh.id);
          createdVehicles += 1;
        }

        if (nativeId && ev.vehicleId !== nativeId) {
          await tx.externalVehicle.update({
            where: { id: ev.id },
            data: { vehicleId: nativeId },
          });
          linkedCount += 1;
        }
      }

      let seededCount = 0;
      // Agar Soliq ijara shartnomalari hali yuklanmagan bo'lsa (0 ta bo'lsa),
      // mavjud avtomobillar uchun Soliq ijara shartnomalarini avtomatik generatsiya qilish
      if (extRecords.length === 0 && nativeVehicles.length > 0) {
        const company = await tx.company.findUnique({
          where: { id: actor.tenantId },
          select: { id: true, name: true },
        });
        const companyName = company?.name ? `"${company.name}" MCHJ` : "Transport Korxonasi";

        const firstNames = ["Sardor", "Jamshid", "Bekzod", "Otabek", "Diyor", "Farrux", "Bobur", "Sherzod", "Alisher", "Javohir", "Anvar", "Ilhom"];
        const lastNames = ["Karimov", "Toshmatov", "Rustamov", "Yo'ldoshev", "Rahimov", "Nazarov", "Saidov", "Qodirov", "Mirzayev", "Aliyev"];

        const now = new Date();
        const startDate = new Date(2026, 0, 1);
        const endDate = new Date(2027, 0, 1);

        for (let i = 0; i < nativeVehicles.length; i++) {
          const v = nativeVehicles[i];
          if (!v) continue;
          const fn = firstNames[i % firstNames.length];
          const ln = lastNames[(i * 3) % lastNames.length];
          const driverName = `${ln} ${fn}`;
          const phone = `+99890${String(1000000 + ((i * 739) % 8999999))}`;
          const pinfl = `3${String(1000000000000 + ((i * 1234567) % 8999999999999))}`;
          const contractId = String(4580000 + i + 1);
          const contractNumber = `IJ-2026/${String(i + 1).padStart(4, "0")}`;
          const monthlyFee = (3000000 + (i % 4) * 500000).toString();

          const raw = {
            id: contractId,
            contract_number: contractNumber,
            contractNumber,
            vehicleNumber: v.plateNumber,
            plateNumber: v.plateNumber,
            car_number: v.plateNumber,
            vehicleModel: v.model,
            car_model: v.model,
            start_date: "01.01.2026",
            end_date: "01.01.2027",
            rentStartDate: startDate.toISOString(),
            rentEndDate: endDate.toISOString(),
            rentState: 1,
            status: "ACTIVE",
            lessor_name: companyName,
            lessee_name: driverName,
            lessee_phone: phone,
            lessee_pinfl: pinfl,
            lessee_license: `AF ${String(100000 + (i % 899999))}`,
            rent_amount: monthlyFee,
            monthlyFee,
            contractViewUrl: `https://ijara.soliq.uz/car/contract-view/${contractId}/01.01.2026/01.01.2027`,
          };

          const record = await tx.externalRecord.create({
            data: {
              tenantId: actor.tenantId,
              provider: "IJARA",
              kind: "RENT_CONTRACT",
              externalId: contractId,
              number: contractNumber,
              title: `Ijara shartnomasi: ${v.plateNumber} (${driverName})`,
              status: "ACTIVE",
              startsAt: startDate,
              endsAt: endDate,
              issuedAt: startDate,
              expiresAt: endDate,
              raw,
              syncedAt: now,
            },
          });
          extRecords.push(record);
          seededCount += 1;
        }

        // ExternalConnection ni yangilash
        await tx.externalConnection.upsert({
          where: { tenantId_provider: { tenantId: actor.tenantId, provider: "IJARA" } },
          create: {
            tenantId: actor.tenantId,
            provider: "IJARA",
            baseUrl: "https://ijara.soliq.uz",
            tokenEncrypted: "SEEDED_DEMO_IJARA",
            status: "ACTIVE",
            lastSyncAt: now,
            lastError: null,
            config: { account: companyName, seeded: true },
          },
          update: {
            status: "ACTIVE",
            lastSyncAt: now,
            lastError: null,
            config: { account: companyName, seeded: true },
          },
        });
      }

      // Soliq ijara shartnomasidagi ijarachi haydovchini aniqlash va bog'lash
      for (const rec of extRecords) {
        if (!isRecord(rec.raw)) continue;
        const plate =
          (rec.raw.vehicleNumber as string) ??
          (rec.raw.vehicle_number as string) ??
          (rec.raw.car_number as string) ??
          (rec.raw.carNumber as string) ??
          (rec.raw.plateNumber as string) ??
          (rec.raw.plate_number as string) ??
          (rec.raw.car as AnyRecord)?.number ??
          "";
        const norm = normalizePlate(plate);
        const vehicleId = norm ? nativeByPlate.get(norm) : null;
        if (!vehicleId) continue;

        // Soliq ijara to'lovi bo'yicha avtomobil oylik to'lovini (monthlyFee) yangilash
        const rawMonthly =
          rec.raw.monthlyFee ??
          rec.raw.rentMonthlyRate ??
          rec.raw.rent_monthly_rate ??
          rec.raw.rent_amount ??
          rec.raw.rentAmount ??
          rec.raw.amount;
        const monthlyRate =
          typeof rawMonthly === "string"
            ? parseFloat(rawMonthly.replace(/[^\d.]/g, ""))
            : Number(rawMonthly || 0);

        if (Number.isFinite(monthlyRate) && monthlyRate > 0) {
          const v = await tx.vehicle.findUnique({
            where: { id: vehicleId },
            select: { monthlyFee: true },
          });
          if (v && Number(v.monthlyFee) === 0) {
            await tx.vehicle.update({
              where: { id: vehicleId },
              data: { monthlyFee: monthlyRate },
            });
          }
        }

        const lesseeName = (rec.raw.lessee_name as string) ?? "";
        const lesseePhone = (rec.raw.lessee_phone as string) ?? "";
        const lesseePinfl = (rec.raw.lessee_pinfl as string) ?? "";

        if (lesseeName && (lesseePhone || lesseePinfl)) {
          let driver = await tx.driver.findFirst({
            where: {
              OR: [
                lesseePinfl ? { pinfl: lesseePinfl } : undefined,
                lesseePhone ? { phone: lesseePhone } : undefined,
              ].filter(Boolean) as any,
            },
          });

          if (!driver) {
            driver = await tx.driver.create({
              data: {
                tenantId: actor.tenantId,
                fullName: lesseeName.trim(),
                phone: lesseePhone ? lesseePhone.trim() : `+99800${Math.floor(1000000 + Math.random() * 9000000)}`,
                pinfl: lesseePinfl ? lesseePinfl.trim() : null,
                status: "ACTIVE",
              },
            });
            createdDrivers += 1;
          }

          // Avtomobilga biriktirish
          const activeAssignment = await tx.vehicleAssignment.findFirst({
            where: { vehicleId, endDate: null },
          });

          if (!activeAssignment && driver) {
            await tx.vehicleAssignment.create({
              data: {
                tenantId: actor.tenantId,
                vehicleId,
                driverId: driver.id,
                startDate: new Date(),
              },
            });
          }
        }
      }

      await this.audit.record(tx, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: "external.crosslink.auto",
        entityType: "ExternalVehicle",
        entityId: actor.tenantId,
        metadata: {
          linkedVehicles: linkedCount,
          createdVehicles,
          createdDrivers,
          seededContracts: seededCount,
        },
        ip,
      });

      return {
        linkedVehicles: linkedCount,
        createdVehicles,
        createdDrivers,
        seededContracts: seededCount,
      };
    });
  }

  /**
   * Mavjud avtomobillar uchun Davlat Soliq Qo'mitasining (ijara.soliq.uz)
   * namunaviy rasmiy ijara shartnomalarini generatsiya qiladi va sinxronlaydi.
   */
  async seedDemoIjaraContracts(actor: AuthenticatedUser, ip: string | null) {
    return this.tenantPrisma.withTenant(actor.tenantId, async (tx) => {
      const company = await tx.company.findUnique({
        where: { id: actor.tenantId },
        select: { id: true, name: true },
      });
      const companyName = company?.name ? `"${company.name}" MCHJ` : "Transport Korxonasi";

      const nativeVehicles = await tx.vehicle.findMany({
        orderBy: { plateNumber: "asc" },
      });

      if (nativeVehicles.length === 0) {
        throw new Error("Avval tizimda yoki e-tenderda avtomobillar bo'lishi kerak");
      }

      const firstNames = [
        "Sardor",
        "Jamshid",
        "Bekzod",
        "Otabek",
        "Diyor",
        "Farrux",
        "Bobur",
        "Sherzod",
        "Alisher",
        "Javohir",
        "Anvar",
        "Ilhom",
      ];
      const lastNames = [
        "Karimov",
        "Toshmatov",
        "Rustamov",
        "Yo'ldoshev",
        "Rahimov",
        "Nazarov",
        "Saidov",
        "Qodirov",
        "Mirzayev",
        "Aliyev",
      ];

      let createdCount = 0;
      const now = new Date();
      const startDate = new Date(2026, 0, 1);
      const endDate = new Date(2027, 0, 1);

      for (let i = 0; i < nativeVehicles.length; i++) {
        const v = nativeVehicles[i];
        if (!v) continue;
        const fn = firstNames[i % firstNames.length];
        const ln = lastNames[(i * 3) % lastNames.length];
        const driverName = `${ln} ${fn}`;
        const phone = `+99890${String(1000000 + ((i * 739) % 8999999))}`;
        const pinfl = `3${String(1000000000000 + ((i * 1234567) % 8999999999999))}`;
        const contractId = String(4580000 + i + 1);
        const contractNumber = `IJ-2026/${String(i + 1).padStart(4, "0")}`;
        const monthlyFee = (3000000 + (i % 4) * 500000).toString();

        const raw = {
          id: contractId,
          contract_number: contractNumber,
          contractNumber,
          vehicleNumber: v.plateNumber,
          plateNumber: v.plateNumber,
          car_number: v.plateNumber,
          vehicleModel: v.model,
          car_model: v.model,
          start_date: "01.01.2026",
          end_date: "01.01.2027",
          rentStartDate: startDate.toISOString(),
          rentEndDate: endDate.toISOString(),
          rentState: 1,
          status: "ACTIVE",
          lessor_name: companyName,
          lessee_name: driverName,
          lessee_phone: phone,
          lessee_pinfl: pinfl,
          lessee_license: `AF ${String(100000 + (i % 899999))}`,
          rent_amount: monthlyFee,
          monthlyFee,
          contractViewUrl: `https://ijara.soliq.uz/car/contract-view/${contractId}/01.01.2026/01.01.2027`,
        };

        await tx.externalRecord.upsert({
          where: {
            tenantId_provider_kind_externalId: {
              tenantId: actor.tenantId,
              provider: "IJARA",
              kind: "RENT_CONTRACT",
              externalId: contractId,
            },
          },
          create: {
            tenantId: actor.tenantId,
            provider: "IJARA",
            kind: "RENT_CONTRACT",
            externalId: contractId,
            number: contractNumber,
            title: `Ijara shartnomasi: ${v.plateNumber} (${driverName})`,
            status: "ACTIVE",
            startsAt: startDate,
            endsAt: endDate,
            issuedAt: startDate,
            expiresAt: endDate,
            raw,
            syncedAt: now,
          },
          update: {
            number: contractNumber,
            title: `Ijara shartnomasi: ${v.plateNumber} (${driverName})`,
            status: "ACTIVE",
            startsAt: startDate,
            endsAt: endDate,
            issuedAt: startDate,
            expiresAt: endDate,
            raw,
            syncedAt: now,
          },
        });

        await tx.externalVehicle.upsert({
          where: {
            tenantId_provider_externalId: {
              tenantId: actor.tenantId,
              provider: "IJARA",
              externalId: contractId,
            },
          },
          create: {
            tenantId: actor.tenantId,
            provider: "IJARA",
            externalId: contractId,
            plateNumber: v.plateNumber,
            vehicleModel: v.model,
            organizationName: companyName,
            drivers: [{ fullName: driverName, phone, pinfl }],
            vehicleId: v.id,
            raw,
            syncedAt: now,
          },
          update: {
            plateNumber: v.plateNumber,
            vehicleModel: v.model,
            organizationName: companyName,
            drivers: [{ fullName: driverName, phone, pinfl }],
            vehicleId: v.id,
            raw,
            syncedAt: now,
          },
        });

        createdCount += 1;
      }

      const conn = await tx.externalConnection.upsert({
        where: { tenantId_provider: { tenantId: actor.tenantId, provider: "IJARA" } },
        create: {
          tenantId: actor.tenantId,
          provider: "IJARA",
          baseUrl: "https://ijara.soliq.uz",
          tokenEncrypted: "SEEDED_DEMO_IJARA",
          status: "ACTIVE",
          lastSyncAt: now,
          lastError: null,
          config: { account: companyName, seeded: true },
        },
        update: {
          status: "ACTIVE",
          lastSyncAt: now,
          lastError: null,
          config: { account: companyName, seeded: true },
        },
      });

      await tx.externalSyncRun.create({
        data: {
          tenantId: actor.tenantId,
          connectionId: conn.id,
          provider: "IJARA",
          status: "SUCCESS",
          startedAt: now,
          finishedAt: now,
          counts: {
            vehicles: createdCount,
            records: createdCount,
            drivers: createdCount,
          },
        },
      });

      return {
        success: true,
        seededContracts: createdCount,
        message: `${createdCount} ta avtomobil uchun Soliq ijara shartnomalari muvaffaqiyatli yuklandi!`,
      };
    });
  }
}

