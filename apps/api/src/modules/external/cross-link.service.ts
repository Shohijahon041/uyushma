import { existsSync } from "node:fs";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { type ExternalRecord, type ExternalVehicle } from "@prisma/client";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import type { AuthenticatedUser } from "../../common/auth/auth.types";
import { PrismaService } from "../../common/prisma/prisma.service";
import { TenantPrismaService } from "../../common/prisma/tenant-prisma.service";
import { AuditService } from "../audit/audit.service";
import {
  dateOnlyTashkent,
  formatDmY,
  formatPlateDisplay,
  normalizePlate,
} from "./connectors/mapping";
import {
  ijaraPlate,
  isDemoIjaraRecord,
  pickIjaraRecord,
  pickIjaraVehicle,
  positiveMoney,
} from "./ijara-contract";
import { createNativeVehicleSafe } from "./native-vehicle";
import { type CrossLinkedVehicleView, type PublicVehiclePassport } from "./external.types";

type AnyRecord = Record<string, unknown>;

/**
 * PDF standart Helvetica shrifti kirill va o'zbekcha maxsus belgilarni
 * qo'llamaydi (matn buzilib chiqadi). Shuning uchun Unicode shrift topilsa,
 * o'sha ishlatiladi; topilmasa Helvetica'ga qaytamiz.
 */
function pickPdfFont(candidates: Array<string | undefined>): string | null {
  for (const path of candidates) {
    if (path && existsSync(path)) return path;
  }
  return null;
}

function isRecord(value: unknown): value is AnyRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function modelKey(value: string | null | undefined): string {
  return (value ?? "").toLocaleLowerCase("ru").replace(/[^\p{L}\p{N}]+/gu, "");
}

function modelsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = modelKey(a);
  const right = modelKey(b);
  return left.length > 0 && right.length > 0 && (left.includes(right) || right.includes(left));
}

@Injectable()
export class ExternalCrossLinkService {
  private readonly logger = new Logger(ExternalCrossLinkService.name);

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
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
          orderBy: [{ plateNumber: "asc" }, { syncedAt: "desc" }],
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
            contracts: {
              where: { status: "ACTIVE" },
              orderBy: { createdAt: "desc" },
              take: 1,
              select: {
                id: true,
                type: true,
                status: true,
                startDate: true,
                endDate: true,
                monthlyRate: true,
              },
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
          ijaraVehicles: ExternalVehicle[];
          etenderVeh?: ExternalVehicle;
          autoparkVeh?: ExternalVehicle;
          ijaraRecords: ExternalRecord[];
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
            ijaraVehicles: [],
            ijaraRecords: [],
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

        if (ev.provider === "IJARA") entry.ijaraVehicles.push(ev);
        else if (ev.provider === "ETENDER") entry.etenderVeh ??= ev;
        else if (ev.provider === "AUTOPARK") entry.autoparkVeh ??= ev;
      }

      for (const entry of plateMap.values()) {
        entry.ijaraVeh = pickIjaraVehicle(entry.ijaraVehicles) ?? undefined;
      }

      // 3. Ijara shartnomalari (ijara.soliq.uz) yozuvlarini bog'lash
      for (const rec of extRecords) {
        if (rec.kind !== "RENT_CONTRACT" || isDemoIjaraRecord(rec)) continue;
        const entry = getOrCreate(ijaraPlate(rec.raw));
        if (entry) entry.ijaraRecords.push(rec);
      }

      const now = Date.now();
      const items: CrossLinkedVehicleView[] = [];

      for (const [norm, data] of plateMap.entries()) {
        const ijaraRecord = pickIjaraRecord(data.ijaraRecords, now);
        const rawIjara = isRecord(ijaraRecord?.raw) ? ijaraRecord.raw : {};
        const rawIjaraVeh = isRecord(data.ijaraVeh?.raw) ? data.ijaraVeh.raw : {};

        // Ijara shartnomasi ma'lumotlari (eng so'nggi faol haqiqiy shartnoma)
        let ijaraInfo: CrossLinkedVehicleView["ijara"] = null;
        if (ijaraRecord || data.ijaraVeh) {
          const rec = ijaraRecord;
          const contractId =
            rec?.externalId ??
            (rawIjaraVeh.contract_id as string) ??
            (rawIjaraVeh.id as string) ??
            "";
          const starts = dateOnlyTashkent(rec?.startsAt);
          const ends = dateOnlyTashkent(rec?.endsAt);
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
            (rawIjara.fromName as string) ??
            (rawIjaraVeh.fromName as string) ??
            (rawIjara.lessee_name as string) ??
            (rawIjaraVeh.lessee_name as string) ??
            null;

          const lesseePinfl =
            (driversObj?.pinfl as string) ??
            (rawIjara.fromPersonId as string) ??
            (rawIjaraVeh.fromPersonId as string) ??
            (rawIjara.lessee_pinfl as string) ??
            null;

          const rawPhone =
            (driversObj?.phone as string) ??
            (rawIjara.fromPhone as string) ??
            (rawIjaraVeh.fromPhone as string) ??
            (rawIjara.lessee_phone as string) ??
            null;

          const lesseePhone = rawPhone
            ? (rawPhone.startsWith("+") ? rawPhone : `+${rawPhone.replace(/\D/g, "")}`)
            : null;

          const lessor =
            (rawIjara.toName as string) ??
            (rawIjaraVeh.toName as string) ??
            data.ijaraVeh?.organizationName ??
            (rawIjara.lessor_name as string) ??
            null;

          const monthlyFee =
            positiveMoney(rawIjara.monthlyFee) ??
            positiveMoney(rawIjara.rentMonthlyRate) ??
            positiveMoney(rawIjara.rentSum) ??
            positiveMoney(rawIjara.rent_amount);

          ijaraInfo = {
            contractId,
            contractNumber: rec?.number ?? contractId,
            startsAt: starts,
            endsAt: ends,
            isExpired,
            status: rec?.status ?? "ACTIVE",
            contractViewUrl: contractUrl,
            monthlyFee,
            lessor,
            lessee: lesseeFullName
              ? {
                  fullName: lesseeFullName,
                  pinfl: lesseePinfl,
                  phone: lesseePhone,
                }
              : null,
          };
        }

        const nativeDriver = data.nativeVeh?.assignments?.[0]?.driver
          ? {
              fullName: data.nativeVeh.assignments[0].driver.fullName,
              phone: data.nativeVeh.assignments[0].driver.phone ?? null,
            }
          : null;

        const nativeContract = data.nativeVeh?.contracts?.[0]
          ? {
              id: data.nativeVeh.contracts[0].id,
              type: data.nativeVeh.contracts[0].type,
              status: data.nativeVeh.contracts[0].status,
              startDate: data.nativeVeh.contracts[0].startDate
                ? data.nativeVeh.contracts[0].startDate.toISOString().slice(0, 10)
                : null,
              endDate: data.nativeVeh.contracts[0].endDate
                ? data.nativeVeh.contracts[0].endDate.toISOString().slice(0, 10)
                : null,
              monthlyRate: data.nativeVeh.contracts[0].monthlyRate
                ? String(data.nativeVeh.contracts[0].monthlyRate)
                : null,
            }
          : null;

        // Agar Soliq ijara shartnomasi bo'lmasa, lekin tizimda ichki ijara shartnomasi bo'lsa
        if (!ijaraInfo && nativeContract) {
          ijaraInfo = {
            contractId: nativeContract.id,
            contractNumber: `IJ-${nativeContract.id.slice(0, 6).toUpperCase()} (Ichki)`,
            startsAt: nativeContract.startDate,
            endsAt: nativeContract.endDate,
            isExpired: false,
            status: nativeContract.status,
            contractViewUrl: "/contracts",
            monthlyFee: nativeContract.monthlyRate,
            lessor: "Korxona",
            lessee: nativeDriver
              ? {
                  fullName: nativeDriver.fullName,
                  pinfl: null,
                  phone: nativeDriver.phone,
                }
              : null,
          };
        }

        // Agar ijara shartnomasida haydovchi ismi ko'rsatilmagan bo'lsa, lekin tizimda biriktirilgan haydovchi bo'lsa
        if (ijaraInfo && !ijaraInfo.lessee && nativeDriver) {
          ijaraInfo.lessee = {
            fullName: nativeDriver.fullName,
            pinfl: null,
            phone: nativeDriver.phone,
          };
        }

        // E-tender ma'lumotlari
        let etenderInfo: CrossLinkedVehicleView["etender"] = null;
        if (data.etenderVeh) {
          const expiresAt = dateOnlyTashkent(data.etenderVeh.licenseExpiresAt);
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
            vehicleModel: data.autoparkVeh.vehicleModel,
            vehicleClass: data.autoparkVeh.vehicleClass,
            drivers: driversList,
          };
        }

        // Qonuniylik va hujjatlar holatini tekshirish
        let complianceStatus: CrossLinkedVehicleView["complianceStatus"] = "PARTIAL";
        const notes: string[] = [];

        if (!ijaraInfo) {
          complianceStatus = "NO_RENT_CONTRACT";
          notes.push("ijara.soliq.uz yoki tizimda ro'yxatdan o'tgan ijara shartnomasi topilmadi.");
        } else if (ijaraInfo.isExpired) {
          complianceStatus = "EXPIRED";
          notes.push(`Ijara shartnomasi muddati o'tgan (${ijaraInfo.endsAt}).`);
        } else {
          const isSoliq = ijaraInfo.contractViewUrl.includes("soliq.uz");
          notes.push(`${isSoliq ? "Soliq" : "Ichki"} ijara shartnomasi faol (#${ijaraInfo.contractNumber}).`);
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
          autoparkInfo?.vehicleModel &&
          data.model &&
          !modelsMatch(autoparkInfo.vehicleModel, data.model)
        ) {
          notes.push(
            `BM'da model boshqacha ko'rsatilgan (${autoparkInfo.vehicleModel}), hujjatlarda ${data.model}.`,
          );
        }

        if (
          ijaraInfo &&
          !ijaraInfo.isExpired &&
          etenderInfo &&
          !etenderInfo.isExpired
        ) {
          complianceStatus = "FULLY_COMPLIANT";
        }

        let daysToLicenseExpiry: number | null = null;
        if (data.etenderVeh?.licenseExpiresAt) {
          const diffMs = data.etenderVeh.licenseExpiresAt.getTime() - now;
          daysToLicenseExpiry = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        }

        let daysToRentExpiry: number | null = null;
        if (ijaraRecord?.endsAt) {
          const diffMs = ijaraRecord.endsAt.getTime() - now;
          daysToRentExpiry = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        }

        let urgencyLevel: "EXPIRED" | "URGENT_15" | "WARNING_30" | "SAFE" | "NO_RENT" = "SAFE";
        if (!ijaraInfo) {
          urgencyLevel = "NO_RENT";
        } else if (ijaraInfo.isExpired || (etenderInfo && etenderInfo.isExpired)) {
          urgencyLevel = "EXPIRED";
        } else if (
          (daysToLicenseExpiry !== null && daysToLicenseExpiry <= 15 && daysToLicenseExpiry >= 0) ||
          (daysToRentExpiry !== null && daysToRentExpiry <= 15 && daysToRentExpiry >= 0)
        ) {
          urgencyLevel = "URGENT_15";
          notes.push(`⚠️ DIQQAT: Litsenziya yoki ijara muddati tugashiga 15 kundan kam qoldi!`);
        } else if (
          (daysToLicenseExpiry !== null && daysToLicenseExpiry <= 30 && daysToLicenseExpiry >= 0) ||
          (daysToRentExpiry !== null && daysToRentExpiry <= 30 && daysToRentExpiry >= 0)
        ) {
          urgencyLevel = "WARNING_30";
          notes.push(`🟡 OGOHLANTIRISH: Litsenziya yoki ijara muddati tugashiga 30 kundan kam qoldi.`);
        }

        items.push({
          plateNumber: data.rawPlate,
          normalizedPlate: norm,
          model: data.model,
          vin: data.vin,
          nativeVehicleId: data.nativeVeh?.id ?? null,
          nativeVehicleStatus: data.nativeVeh?.status ?? null,
          nativeDriver,
          nativeContract,
          ijara: ijaraInfo,
          etender: etenderInfo,
          autopark: autoparkInfo,
          complianceStatus,
          complianceNotes: notes,
          daysToLicenseExpiry,
          daysToRentExpiry,
          urgencyLevel,
        });
      }

      // Statistika hisoblash
      const totals = {
        totalVehicles: items.length,
        fullyCompliant: items.filter((i) => i.complianceStatus === "FULLY_COMPLIANT").length,
        partial: items.filter((i) => i.complianceStatus === "PARTIAL").length,
        expired: items.filter((i) => i.complianceStatus === "EXPIRED").length,
        noRentContract: items.filter((i) => i.complianceStatus === "NO_RENT_CONTRACT").length,
        expiringSoon15: items.filter((i) => i.urgencyLevel === "URGENT_15").length,
        expiringSoon30: items.filter((i) => i.urgencyLevel === "WARNING_30").length,
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
          const newVeh = await createNativeVehicleSafe(tx, {
            tenantId: actor.tenantId,
            ownerId: owner.id,
            plateNumber: ev.plateNumber.trim().toUpperCase(),
            model: (ev.vehicleModel ?? "Transport").trim().slice(0, 120),
            capacity: 0,
            status: "ACTIVE",
          });
          nativeId = newVeh.id;
          nativeByPlate.set(norm, newVeh.id);
          if (newVeh.created) createdVehicles += 1;
        }

        if (nativeId && ev.vehicleId !== nativeId) {
          await tx.externalVehicle.update({
            where: { id: ev.id },
            data: { vehicleId: nativeId },
          });
          linkedCount += 1;
        }
      }

      // Soliq ijara shartnomasidagi ijarachi haydovchini aniqlash va bog'lash
      for (const rec of extRecords) {
        if (isDemoIjaraRecord(rec) || !isRecord(rec.raw)) continue;
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
        let vehicleId = norm ? nativeByPlate.get(norm) : null;

        // Agar avtomobil native bazada hali mavjud bo'lmasa, uni yaratish
        if (!vehicleId && norm && plate && owner) {
          const modelName =
            (rec.raw.vehicleModel as string) ??
            (rec.raw.vehicle_model as string) ??
            (rec.raw.car_model as string) ??
            (rec.raw.carModel as string) ??
            "DAMAS";
          const newVeh = await createNativeVehicleSafe(tx, {
            tenantId: actor.tenantId,
            ownerId: owner.id,
            plateNumber: plate.trim().toUpperCase(),
            model: modelName.trim().slice(0, 120),
            capacity: 0,
            status: "ACTIVE",
          });
          vehicleId = newVeh.id;
          nativeByPlate.set(norm, newVeh.id);
          if (newVeh.created) createdVehicles += 1;
        }

        if (!vehicleId) continue;

        // Soliq ijara to'lovi bo'yicha avtomobil oylik to'lovini (monthlyFee) yangilash
        const rawMonthly =
          rec.raw.monthlyFee ??
          rec.raw.rentMonthlyRate ??
          rec.raw.rent_monthly_rate ??
          rec.raw.rentSum ??
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

        const citizenName =
          (rec.raw.fromName as string) ??
          (rec.raw.fromDirectorName as string) ??
          (rec.raw.lessee_name as string) ??
          (rec.raw.driver_name as string) ??
          "";
        const rawPhone =
          (rec.raw.fromPhone as string) ??
          (rec.raw.lessee_phone as string) ??
          (rec.raw.phone as string) ??
          "";
        const citizenPhone = rawPhone
          ? (rawPhone.startsWith("+") ? rawPhone.trim() : `+${rawPhone.replace(/\D/g, "")}`)
          : "";
        const citizenPinfl =
          (rec.raw.fromPersonId as string) ??
          (rec.raw.fromPinfl as string) ??
          (rec.raw.lessee_pinfl as string) ??
          (rec.raw.pinfl as string) ??
          "";

        if (citizenName && (citizenPhone || citizenPinfl)) {
          let driver = await tx.driver.findFirst({
            where: {
              tenantId: actor.tenantId,
              OR: [
                citizenPinfl ? { pinfl: citizenPinfl } : undefined,
                citizenPhone ? { phone: citizenPhone } : undefined,
              ].filter(Boolean) as any,
            },
          });

          if (!driver) {
            const fallbackPhone = citizenPhone || `+99800${Math.floor(1000000 + Math.random() * 9000000)}`;
            // Telefon raqami takrorlanmasligi uchun
            const existingPhone = await tx.driver.findFirst({
              where: { tenantId: actor.tenantId, phone: fallbackPhone },
            });
            const finalPhone = existingPhone
              ? `+998${Math.floor(100000000 + Math.random() * 899999999)}`
              : fallbackPhone;

            driver = await tx.driver.create({
              data: {
                tenantId: actor.tenantId,
                fullName: citizenName.trim(),
                phone: finalPhone,
                pinfl: citizenPinfl ? citizenPinfl.trim() : null,
                status: "ACTIVE",
                notes: plate ? `Soliq Ijara: ${plate}` : "Soliq Ijara",
              },
            });
            createdDrivers += 1;
          } else {
            // Mavjud haydovchi maydonlarini to'ldirish
            const patch: Record<string, unknown> = {};
            if (!driver.pinfl && citizenPinfl) patch.pinfl = citizenPinfl;
            if (Object.keys(patch).length > 0) {
              await tx.driver.update({ where: { id: driver.id }, data: patch });
            }
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
        },
        ip,
      });

      return {
        linkedVehicles: linkedCount,
        createdVehicles,
        createdDrivers,
      };
    });
  }

  /**
   * Yo'l inspeksiyasi (YPX / Transport nazorati) va yo'lovchilar uchun
   * davlat raqami bo'yicha avtomobilning raqamli pasporti va haqiqiyligini tekshirish (Public Verification)
   */
  async getPublicPassport(plateRaw: string): Promise<PublicVehiclePassport | null> {
    const norm = normalizePlate(plateRaw);
    if (!norm) return null;

    // Superuser function orqali avtomobil va uning tenantini aniqlash (RLS xavfsiz holda)
    const rows = await this.prisma.$queryRaw<
      Array<{ tenant_id: string; vehicle_id: string | null; plate_number: string }>
    >`SELECT tenant_id, vehicle_id, plate_number FROM app_resolve_vehicle_tenant(${plateRaw}) LIMIT 1`;

    const match = rows[0];
    if (!match) {
      return null;
    }

    return this.tenantPrisma.withTenant(match.tenant_id, async (tx) => {
      const vehicleInclude = {
        company: { select: { name: true } },
        route: { select: { name: true } },
        assignments: {
          where: { endDate: null },
          take: 1,
          include: { driver: { select: { fullName: true, phone: true } } },
        },
        shifts: {
          where: { status: "ACTIVE" },
          orderBy: { startedAt: "desc" },
          take: 1,
        },
      } as const;

      const [vehicle, externalVehicles, rentRecords] = await Promise.all([
        match.vehicle_id
          ? tx.vehicle.findUnique({
              where: { id: match.vehicle_id },
              include: vehicleInclude,
            })
          : tx.vehicle.findFirst({
              where: {
                OR: [
                  { plateNumber: { equals: plateRaw.trim(), mode: "insensitive" } },
                  { plateNumber: { equals: norm, mode: "insensitive" } },
                ],
              },
              include: vehicleInclude,
            }),
        tx.externalVehicle.findMany({
          where: {
            OR: [
              { plateNumber: { equals: plateRaw.trim(), mode: "insensitive" } },
              { plateNumber: { equals: norm, mode: "insensitive" } },
            ],
          },
          orderBy: { syncedAt: "desc" },
        }),
        tx.externalRecord.findMany({ where: { kind: "RENT_CONTRACT" } }),
      ]);

      const now = Date.now();
      const etenderVehicle =
        externalVehicles.find((row) => row.provider === "ETENDER") ?? null;
      const autoparkVehicle =
        externalVehicles.find((row) => row.provider === "AUTOPARK") ?? null;
      const ijaraVehicle = pickIjaraVehicle(
        externalVehicles.filter((row) => row.provider === "IJARA"),
      );

      // Faqat shu raqamga tegishli, haqiqiy (demo bo'lmagan) Soliq shartnomasi.
      const rentRecord = pickIjaraRecord(
        rentRecords.filter((record) => {
          const plate = ijaraPlate(record.raw);
          return plate ? plate === norm : normalizePlate(record.title).includes(norm);
        }),
        now,
      );

      if (!vehicle && !etenderVehicle && !autoparkVehicle && !ijaraVehicle && !rentRecord) {
        return null;
      }

      const ijaraDriver = Array.isArray(ijaraVehicle?.drivers)
        ? (ijaraVehicle.drivers[0] as Record<string, unknown> | undefined)
        : undefined;
      const rentRaw = isRecord(rentRecord?.raw) ? rentRecord.raw : {};
      const lesseeName =
        (rentRaw.fromName as string) ??
        (rentRaw.fromDirectorName as string) ??
        (rentRaw.lessee_name as string) ??
        (rentRaw.driver_name as string) ??
        (ijaraDriver?.fullName as string) ??
        null;
      const lesseePinfl =
        (rentRaw.fromPersonId as string) ??
        (rentRaw.fromPinfl as string) ??
        (rentRaw.lessee_pinfl as string) ??
        (ijaraDriver?.pinfl as string) ??
        null;
      const rawPhone =
        (rentRaw.fromPhone as string) ??
        (rentRaw.lessee_phone as string) ??
        (ijaraDriver?.phone as string) ??
        null;
      const lesseePhone = rawPhone
        ? rawPhone.startsWith("+")
          ? rawPhone.trim()
          : `+${rawPhone.replace(/\D/g, "")}`
        : null;

      const licenseVehicle =
        [etenderVehicle, autoparkVehicle, ijaraVehicle].find((row) => row?.licenseNumber) ?? null;
      const licenseNumber = licenseVehicle?.licenseNumber ?? null;
      const licenseExpiresAt = licenseVehicle?.licenseExpiresAt ?? null;
      const isLicenseExpired = licenseExpiresAt ? licenseExpiresAt.getTime() < now : false;
      const licenseValid = !!licenseNumber && !isLicenseExpired;
      const daysToLicense = licenseExpiresAt
        ? Math.ceil((licenseExpiresAt.getTime() - now) / (1000 * 60 * 60 * 24))
        : null;

      const rentEndsAt = rentRecord?.endsAt ?? null;
      const isRentExpired = rentEndsAt ? rentEndsAt.getTime() < now : false;
      const rentValid = !!rentRecord && !isRentExpired;
      const daysToRent = rentEndsAt
        ? Math.ceil((rentEndsAt.getTime() - now) / (1000 * 60 * 60 * 24))
        : null;

      const activeShift = vehicle?.shifts?.[0];
      const nativeDriver = vehicle?.assignments[0]?.driver;
      const driverName = lesseeName ?? nativeDriver?.fullName ?? null;
      const driverPhone = lesseePhone ?? nativeDriver?.phone ?? null;

      let complianceStatus: PublicVehiclePassport["complianceStatus"];
      if (!rentRecord) complianceStatus = "NO_RENT_CONTRACT";
      else if (isRentExpired || isLicenseExpired) complianceStatus = "EXPIRED";
      else if (rentValid && licenseValid) complianceStatus = "FULLY_COMPLIANT";
      else complianceStatus = "PARTIAL";

      const verificationNotes: string[] = [];
      if (!rentRecord) verificationNotes.push("ijara.soliq.uz shartnomasi topilmadi");
      else if (isRentExpired) verificationNotes.push("Soliq ijara shartnomasi muddati o'tgan");
      else
        verificationNotes.push(
          `Soliq ijara shartnomasi faol (#${rentRecord.number ?? rentRecord.externalId})`,
        );
      if (!licenseNumber) verificationNotes.push("e-tender litsenziyasi topilmadi");
      else if (isLicenseExpired)
        verificationNotes.push("e-tender litsenziyasi muddati o'tgan");
      else verificationNotes.push(`e-tender litsenziyasi faol (#${licenseNumber})`);

      const resolvedPlate =
        vehicle?.plateNumber ??
        etenderVehicle?.plateNumber ??
        ijaraVehicle?.plateNumber ??
        match.plate_number;

      return {
        plateNumber: resolvedPlate,
        plateDisplay: formatPlateDisplay(resolvedPlate),
        model:
          vehicle?.model ??
          etenderVehicle?.vehicleModel ??
          ijaraVehicle?.vehicleModel ??
          autoparkVehicle?.vehicleModel ??
          "Transport vositasi",
        vin:
          etenderVehicle?.vin ??
          ijaraVehicle?.vin ??
          autoparkVehicle?.vin ??
          null,
        companyName:
          vehicle?.company?.name ??
          etenderVehicle?.organizationName ??
          autoparkVehicle?.organizationName ??
          ijaraVehicle?.organizationName ??
          "Transport Korxonasi",
        routeName:
          vehicle?.route?.name ??
          etenderVehicle?.routeName ??
          autoparkVehicle?.routeName ??
          null,
        routeNumber: etenderVehicle?.routeNumber ?? autoparkVehicle?.routeNumber ?? null,
        driverName,
        driverPhone,
        driverSource: lesseeName ? "SOLIQ" : nativeDriver ? "PLATFORM" : null,
        license: {
          number: licenseNumber,
          expiresAt: dateOnlyTashkent(licenseExpiresAt),
          isValid: licenseValid,
          daysLeft: daysToLicense,
        },
        soliqLease: {
          contractNumber: rentRecord?.number ?? rentRecord?.externalId ?? null,
          startsAt: dateOnlyTashkent(rentRecord?.startsAt ?? null),
          endsAt: dateOnlyTashkent(rentEndsAt),
          isValid: rentValid,
          daysLeft: daysToRent,
          lesseeName,
          lesseePinfl,
          lesseePhone,
        },
        shiftStatus: {
          isOnShift: !!activeShift,
          startedAt: activeShift ? activeShift.startedAt.toISOString() : null,
        },
        complianceStatus,
        isVerified: rentValid && licenseValid,
        verificationNotes,
        verifiedAt: new Date().toISOString(),
      };
    });
  }

  /**
   * QR Pasport uchun havolani QR kod (PNG) sifatida tayyorlaydi.
   * Havola ochilganda barcha ma'lumotlar jonli reyestrdan qayta tekshiriladi.
   */
  async buildPassportQr(plateNumber: string): Promise<Buffer> {
    const origin = this.config.get<string>("APP_ORIGIN") ?? "https://uyushma.bmbrutto.uz";
    const url = `${origin.replace(/\/$/, "")}/uz/verify/${encodeURIComponent(normalizePlate(plateNumber))}`;
    return QRCode.toBuffer(url, {
      type: "png",
      errorCorrectionLevel: "M",
      margin: 2,
      width: 640,
      color: { dark: "#0f172a", light: "#ffffff" },
    });
  }

  /**
   * Ijara shartnomasi va litsenziya ma'lumotnomasi — chop etish va yuklab olish
   * uchun bir sahifali PDF. Haydovchi botdan, firma esa paneldan oladi.
   */
  async buildPassportPdf(passport: PublicVehiclePassport): Promise<Buffer> {
    const origin = this.config.get<string>("APP_ORIGIN") ?? "https://uyushma.bmbrutto.uz";
    const verifyUrl = `${origin.replace(/\/$/, "")}/uz/verify/${encodeURIComponent(normalizePlate(passport.plateNumber))}`;
    const qr = await this.buildPassportQr(passport.plateNumber);
    const doc = new PDFDocument({
      size: "A4",
      margin: 48,
      info: { Title: `Yo'l pasporti ${passport.plateDisplay}`, Author: "Uyushma" },
    });
    const regularFont = pickPdfFont([
      process.env.PDF_FONT_REGULAR,
      "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
      "C:/Windows/Fonts/arial.ttf",
      "C:/Windows/Fonts/segoeui.ttf",
    ]);
    const boldFont = pickPdfFont([
      process.env.PDF_FONT_BOLD,
      "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
      "C:/Windows/Fonts/arialbd.ttf",
      "C:/Windows/Fonts/segoeuib.ttf",
    ]);
    if (regularFont) doc.registerFont("PassportRegular", regularFont);
    if (boldFont) doc.registerFont("PassportBold", boldFont);
    const regular = regularFont ? "PassportRegular" : "Helvetica";
    const bold = boldFont ? "PassportBold" : "Helvetica-Bold";
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<Buffer>((resolve) => {
      doc.on("end", () => resolve(Buffer.concat(chunks)));
    });

    const dmY = (value: string | null | undefined): string => {
      if (!value) return "—";
      const [year, month, day] = value.slice(0, 10).split("-");
      return year && month && day ? `${day}.${month}.${year}` : value;
    };
    const complianceText: Record<PublicVehiclePassport["complianceStatus"], string> = {
      FULLY_COMPLIANT: "To'liq qonuniy — ijara va litsenziya amal qiladi",
      PARTIAL: "Qisman — ayrim hujjatlarni tekshirish kerak",
      EXPIRED: "Muddati o'tgan hujjat mavjud",
      NO_RENT_CONTRACT: "Soliq ijara shartnomasi topilmadi",
    };

    doc.fillColor("#0f172a").font(bold).fontSize(20).text("RAQAMLI YO'L PASPORTI", 48, 48);
    doc
      .font(regular)
      .fontSize(10)
      .fillColor("#64748b")
      .text("Ijara shartnomasi va litsenziya ma'lumotnomasi", 48, 74);
    doc.image(qr, 452, 44, { width: 96 });
    doc.fontSize(7).fillColor("#94a3b8").text("Skanerlab tekshiring", 452, 144, { width: 96, align: "center" });

    let y = 170;
    doc.roundedRect(48, y, 400, 62, 8).fill("#f1f5f9");
    doc
      .fillColor("#0f172a")
      .font(bold)
      .fontSize(24)
      .text(passport.plateDisplay || passport.plateNumber, 66, y + 12);
    doc
      .font(regular)
      .fontSize(11)
      .fillColor("#475569")
      .text(passport.model || "—", 66, y + 42);
    y += 82;

    const keyValue = (label: string, value: string | null | undefined) => {
      doc.font(bold).fontSize(8.5).fillColor("#64748b").text(label.toUpperCase(), 48, y, { width: 150 });
      doc.font(regular).fontSize(10.5).fillColor("#0f172a").text(value || "—", 200, y, { width: 340 });
      y = Math.max(doc.y + 5, y + 19);
    };
    const section = (title: string) => {
      y += 8;
      doc.font(bold).fontSize(10.5).fillColor("#1d4ed8").text(title, 48, y);
      y += 17;
    };

    section("KORXONA VA YO'NALISH");
    keyValue("Korxona", passport.companyName);
    keyValue(
      "Yo'nalish",
      `${passport.routeNumber ? `№${passport.routeNumber} ` : ""}${passport.routeName ?? ""}`.trim(),
    );

    section("HAYDOVCHI (IJARACHI)");
    keyValue("F.I.Sh.", passport.driverName);
    keyValue("Telefon", passport.driverPhone);
    keyValue("JSHSHIR", passport.soliqLease.lesseePinfl);

    section("SOLIQ IJARA SHARTNOMASI");
    keyValue("Shartnoma raqami", passport.soliqLease.contractNumber);
    keyValue(
      "Amal qilish davri",
      passport.soliqLease.startsAt
        ? `${dmY(passport.soliqLease.startsAt)} — ${dmY(passport.soliqLease.endsAt)}`
        : dmY(passport.soliqLease.endsAt),
    );
    keyValue(
      "Holati",
      passport.soliqLease.isValid
        ? `Amal qiladi${passport.soliqLease.daysLeft !== null ? ` (${passport.soliqLease.daysLeft} kun qoldi)` : ""}`
        : "Amal qilmaydi",
    );

    section("E-TENDER LITSENZIYASI");
    keyValue("Litsenziya raqami", passport.license.number);
    keyValue("Amal qilish muddati", dmY(passport.license.expiresAt));
    keyValue(
      "Holati",
      passport.license.isValid
        ? `Amal qiladi${passport.license.daysLeft !== null ? ` (${passport.license.daysLeft} kun qoldi)` : ""}`
        : "Amal qilmaydi",
    );

    section("UMUMIY MUVOFIQLIK");
    keyValue("Xulosa", complianceText[passport.complianceStatus]);
    for (const note of (passport.verificationNotes ?? []).slice(0, 4)) {
      keyValue("Izoh", note);
    }

    y = Math.max(y + 10, 720);
    doc
      .font(regular)
      .fontSize(8)
      .fillColor("#64748b")
      .text(
        "Ma'lumotlar jonli reyestrdan tekshiriladi: ijara.soliq.uz, e-tender (uztrans.uz) va ichki bazadan. " +
          `Hujjat ${new Date().toLocaleString("uz-UZ", { timeZone: "Asia/Tashkent" })} da shakllantirildi.`,
        48,
        y,
        { width: 499 },
      );
    doc.fontSize(8).fillColor("#2563eb").text(verifyUrl, 48, y + 22, { width: 499 });

    doc.end();
    return done;
  }
}

