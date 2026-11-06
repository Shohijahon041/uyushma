import { Prisma } from "@prisma/client";
import type { TenantTx } from "../../common/prisma/tenant-prisma.service";
import { normalizePlate } from "./connectors/mapping";

type NativeVehicleData = Prisma.VehicleUncheckedCreateInput;

/**
 * Parallel sinxronlashlar bir xil davlat raqamini yaratishga urinishi mumkin.
 * Unikal cheklov yuz bersa, mavjud avtomobilni qaytaradi — sinxronlash yiqilmaydi.
 */
export async function createNativeVehicleSafe(
  tx: TenantTx,
  data: NativeVehicleData,
): Promise<{ id: string; created: boolean }> {
  try {
    const vehicle = await tx.vehicle.create({ data });
    return { id: vehicle.id, created: true };
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
      throw error;
    }
    const plate = normalizePlate(data.plateNumber);
    const rows = await tx.vehicle.findMany({
      where: { tenantId: data.tenantId },
      select: { id: true, plateNumber: true },
    });
    const existing = rows.find((row) => normalizePlate(row.plateNumber) === plate);
    if (!existing) throw error;
    return { id: existing.id, created: false };
  }
}
