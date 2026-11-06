import { Injectable, Logger } from "@nestjs/common";
import * as fs from "node:fs";
import { TenantPrismaService, type TenantTx } from "../../common/prisma/tenant-prisma.service";
import { normalizePlate } from "./connectors/mapping";
import { createNativeVehicleSafe } from "./native-vehicle";

export interface CollectorSummary {
  total_records: number;
  total_vehicles: number;
  by_source: Record<string, number>;
  recent_logs: Array<{
    source: string;
    status: string;
    items: number;
    duration: number;
    at: string;
    error?: string;
  }>;
}

export interface CollectorRecordItem {
  id: number;
  source: string;
  external_id: string;
  record_type: string;
  identifier: string | null;
  title: string | null;
  status: string;
  starts_at: string | null;
  ends_at: string | null;
  amount: number;
  parties: Record<string, any> | null;
  raw_data?: Record<string, any>;
  synced_at: string | null;
  updated_at: string | null;
}

@Injectable()
export class CollectorService {
  private readonly logger = new Logger(CollectorService.name);
  private readonly baseUrl = "http://127.0.0.1:8000";
  private readonly authKey = "admin123";

  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  private getHeaders(): Record<string, string> {
    const basic = Buffer.from("admin:admin123").toString("base64");
    return {
      Authorization: `Basic ${basic}`,
      Accept: "application/json",
    };
  }

  async getStatus(): Promise<{
    online: boolean;
    baseUrl: string;
    summary?: CollectorSummary;
    error?: string;
  }> {
    try {
      const res = await fetch(`${this.baseUrl}/api/summary?key=${this.authKey}`, {
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) {
        return { online: false, baseUrl: this.baseUrl, error: `HTTP ${res.status}` };
      }
      const summary = (await res.json()) as CollectorSummary;
      return { online: true, baseUrl: this.baseUrl, summary };
    } catch (err) {
      return {
        online: false,
        baseUrl: this.baseUrl,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async getSummary(): Promise<CollectorSummary> {
    try {
      const res = await fetch(`${this.baseUrl}/api/summary?key=${this.authKey}`, {
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        return (await res.json()) as CollectorSummary;
      }
    } catch (err) {
      this.logger.warn(`Collector summary olishda xatolik: ${String(err)}`);
    }

    // Fallback: Agar server o'chiq bo'lsa, lokal fayldan tekshirish
    return this.getLocalFallbackSummary();
  }

  async getRecords(query: {
    source?: string;
    record_type?: string;
    search?: string;
    page?: number;
    pageSize?: number;
  }): Promise<CollectorRecordItem[]> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;

    try {
      const url = new URL(`${this.baseUrl}/api/records`);
      url.searchParams.set("key", this.authKey);
      url.searchParams.set("page", String(page));
      url.searchParams.set("page_size", String(pageSize));
      if (query.source) url.searchParams.set("source", query.source);
      if (query.record_type) url.searchParams.set("record_type", query.record_type);
      if (query.search) url.searchParams.set("search", query.search);

      const res = await fetch(url.toString(), {
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        return (await res.json()) as CollectorRecordItem[];
      }
    } catch (err) {
      this.logger.warn(`Collector yozuvlarini olishda xatolik: ${String(err)}`);
    }

    // Fallback
    return this.getLocalFallbackRecords(query);
  }

  async getRecordDetail(id: number): Promise<CollectorRecordItem | null> {
    try {
      const res = await fetch(`${this.baseUrl}/api/records/${id}?key=${this.authKey}`, {
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        return (await res.json()) as CollectorRecordItem;
      }
    } catch (err) {
      this.logger.warn(`Collector detail olishda xatolik (${id}): ${String(err)}`);
    }
    return null;
  }

  async triggerSync(): Promise<{ status: string; message: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/api/sync/run?key=${this.authKey}`, {
        method: "POST",
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        return (await res.json()) as { status: string; message: string };
      }
      return { status: "ERROR", message: `Server HTTP ${res.status} javob berdi` };
    } catch (err) {
      return {
        status: "FAILED",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async getSyncStatus(): Promise<Record<string, any>> {
    try {
      const res = await fetch(`${this.baseUrl}/api/sync/status?key=${this.authKey}`, {
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        return (await res.json()) as Record<string, any>;
      }
    } catch (err) {
      // ignore
    }
    return { running: false, last_result: null };
  }

  /**
   * Kollektor yozuvlarini to'g'ridan-to'g'ri joriy tenant bazasiga (uyushma)
   * ExternalRecord, Vehicle, Driver va VehicleAssignment sifatida integratsiya qilish
   */
  async importToTenant(tenantId: string): Promise<{
    importedContracts: number;
    createdVehicles: number;
    createdDrivers: number;
    assignedVehicles: number;
  }> {
    const records = await this.getRecords({ pageSize: 1000 });
    let importedContracts = 0;
    let createdVehicles = 0;
    let createdDrivers = 0;
    let assignedVehicles = 0;

    await this.tenantPrisma.withTenant(tenantId, async (tx: TenantTx) => {
      const owner = (await tx.user.findFirst({ where: { tenantId, role: "OWNER" } })) ?? (await tx.user.findFirst({ where: { tenantId } }));
      if (!owner) throw new Error("Tenant uchun egasi (owner) topilmadi");

      const existingVehicles = await tx.vehicle.findMany({ select: { id: true, plateNumber: true } });
      const vehicleMap = new Map<string, string>();
      for (const v of existingVehicles) {
        vehicleMap.set(normalizePlate(v.plateNumber), v.id);
      }

      const existingDrivers = await tx.driver.findMany({ select: { id: true, fullName: true, pinfl: true, phone: true } });
      const driverByPinfl = new Map<string, string>();
      const driverByPhone = new Map<string, string>();
      for (const d of existingDrivers) {
        if (d.pinfl) driverByPinfl.set(d.pinfl, d.id);
        if (d.phone) driverByPhone.set(d.phone, d.id);
      }

      const existingAssignments = await tx.vehicleAssignment.findMany({
        where: { endDate: null },
        select: { vehicleId: true, driverId: true },
      });
      const activeVehicleAssigned = new Set(existingAssignments.map((a: { vehicleId: string }) => a.vehicleId));
      const activeDriverAssigned = new Set(existingAssignments.map((a: { driverId: string }) => a.driverId));

      const now = new Date();

      for (const r of records) {
        const raw = r.raw_data || r.parties || {};
        const plate = r.identifier || (raw.plateNumber as string) || (raw.vehicleNumber as string) || "";
        const normPlate = normalizePlate(plate);
        if (!normPlate) continue;

        // 1. ExternalRecord ni saqlash yoki yangilash
        const extId = r.external_id || `collector_${r.id}`;
        const existingRecord = await tx.externalRecord.findFirst({
          where: { tenantId, externalId: extId },
        });

        const startsAt = r.starts_at ? new Date(r.starts_at) : null;
        const endsAt = r.ends_at ? new Date(r.ends_at) : null;

        if (!existingRecord) {
          await tx.externalRecord.create({
            data: {
              tenantId,
              provider: r.source === "ijara_soliq" ? "IJARA" : r.source === "bm_dtransport" ? "AUTOPARK" : "ETENDER",
              kind: (r.record_type as any) || "RENT_CONTRACT",
              externalId: extId,
              number: raw.contractNumber || raw.rentNumber || r.identifier || extId,
              title: r.title || `Shartnoma: ${plate}`,
              status: r.status || "ACTIVE",
              startsAt,
              endsAt,
              issuedAt: startsAt,
              expiresAt: endsAt,
              raw: { ...raw, parties: r.parties, identifier: plate, source: r.source },
              syncedAt: now,
            },
          });
          importedContracts++;
        }

        // 2. Agar avtomobil bazada bo'lmasa, yaratish
        let vehicleId = vehicleMap.get(normPlate);
        if (!vehicleId) {
          const modelName = raw.carModelName || raw.carMarkName || "Yengil avtomobil";
          const newVeh = await createNativeVehicleSafe(tx, {
            tenantId,
            ownerId: owner.id,
            plateNumber: plate.trim().toUpperCase(),
            model: String(modelName).trim().slice(0, 120),
            capacity: 0,
            status: "ACTIVE",
          });
          vehicleId = newVeh.id;
          vehicleMap.set(normPlate, vehicleId);
          if (newVeh.created) createdVehicles += 1;
        }

        // 3. Haydovchini aniqlash va yaratish
        const driverName = (r.parties?.lessor_name || raw.fromName || raw.fromDirectorName || "").trim();
        const pinfl = (r.parties?.lessor_id || raw.fromPersonId || raw.fromPinfl || "").trim();
        let phone = (r.parties?.lessor_phone || raw.fromPhone || "").trim();
        if (phone && !phone.startsWith("+")) phone = `+${phone}`;

        if (driverName) {
          let driverId = (pinfl && driverByPinfl.get(pinfl)) || (phone && driverByPhone.get(phone));
          if (!driverId) {
            const newDriver = await tx.driver.create({
              data: {
                tenantId,
                fullName: driverName,
                pinfl: pinfl || null,
                phone: phone || null,
                status: "ACTIVE",
              },
            });
            driverId = newDriver.id;
            if (pinfl) driverByPinfl.set(pinfl, driverId);
            if (phone) driverByPhone.set(phone, driverId);
            createdDrivers++;
          }

          // 4. Mashinaga biriktirish (VehicleAssignment)
          if (vehicleId && !activeVehicleAssigned.has(vehicleId) && !activeDriverAssigned.has(driverId)) {
            await tx.vehicleAssignment.create({
              data: {
                tenantId,
                vehicleId,
                driverId,
                startDate: startsAt || now,
                endDate: null,
              },
            });
            activeVehicleAssigned.add(vehicleId);
            activeDriverAssigned.add(driverId);
            assignedVehicles++;
          }
        }
      }
    });

    return {
      importedContracts,
      createdVehicles,
      createdDrivers,
      assignedVehicles,
    };
  }

  private getLocalFallbackSummary(): CollectorSummary {
    const filePath = "d:/Uyushma Dastur/test_output_site3.json";
    if (fs.existsSync(filePath)) {
      try {
        const raw = fs.readFileSync(filePath, "utf8");
        const items = JSON.parse(raw);
        const count = Array.isArray(items) ? items.length : 0;
        return {
          total_records: count,
          total_vehicles: count,
          by_source: { ijara_soliq: count },
          recent_logs: [],
        };
      } catch {
        // ignore
      }
    }
    return {
      total_records: 0,
      total_vehicles: 0,
      by_source: {},
      recent_logs: [],
    };
  }

  private getLocalFallbackRecords(query: { search?: string; page?: number; pageSize?: number }): CollectorRecordItem[] {
    const filePath = "d:/Uyushma Dastur/test_output_site3.json";
    if (!fs.existsSync(filePath)) return [];

    try {
      const raw = fs.readFileSync(filePath, "utf8");
      const items = JSON.parse(raw);
      if (!Array.isArray(items)) return [];

      let mapped: CollectorRecordItem[] = items.map((it: any, idx: number) => {
        const plate = it.carNumber || it.vehicleNumber || "";
        const lessor = it.fromName || it.fromDirectorName || "Fuqaro";
        const lessee = it.toName || '"CARLUX" MCHJ';
        return {
          id: idx + 1,
          source: "ijara_soliq",
          external_id: `ijara_${it.id || idx}`,
          record_type: "RENT_CONTRACT",
          identifier: plate,
          title: `Ijara shartnomasi: ${plate}`,
          status: "ACTIVE",
          starts_at: it.rentStartDate || null,
          ends_at: it.rentEndDate || null,
          amount: Number(it.rentMonthlyRate || it.rentSum || 0),
          parties: {
            lessor_name: lessor,
            lessee_name: lessee,
            lessor_phone: it.fromPhone || "",
            lessor_id: it.fromPersonId || "",
          },
          raw_data: it,
          synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
      });

      if (query.search) {
        const s = query.search.toLowerCase();
        mapped = mapped.filter((r) =>
          (r.identifier && r.identifier.toLowerCase().includes(s)) ||
          (r.title && r.title.toLowerCase().includes(s)) ||
          (r.parties?.lessor_name && r.parties.lessor_name.toLowerCase().includes(s)),
        );
      }

      const p = query.page ?? 1;
      const ps = query.pageSize ?? 50;
      return mapped.slice((p - 1) * ps, p * ps);
    } catch {
      return [];
    }
  }
}
