import { INestApplication } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import request from "supertest";
import {
  asTenant,
  auth,
  bootstrapApp,
  countVisibleVehiclesWithoutTenant,
  createAdminClient,
  registerTenant,
  resetDatabase,
  TEST_URL,
  type RegisteredTenant,
} from "./test-utils";

describe("Tenant isolation with PostgreSQL RLS", () => {
  let app: INestApplication;
  let admin: PrismaClient;
  let tenantA: RegisteredTenant;
  let tenantB: RegisteredTenant;
  let vehicleAId: string;
  let vehicleBId: string;
  let contractBId: string;

  beforeAll(async () => {
    admin = createAdminClient();
    await resetDatabase(admin);
    app = await bootstrapApp();

    tenantA = await registerTenant(app, "alpha-trans");
    tenantB = await registerTenant(app, "beta-trans");

    const vehicleA = await request(app.getHttpServer())
      .post("/api/v1/vehicles")
      .set(auth(tenantA.accessToken))
      .send({
        ownerId: tenantA.userId,
        plateNumber: "01A111AA",
        model: "Isuzu",
        capacity: 30,
      })
      .expect(201);
    vehicleAId = vehicleA.body.id;

    const vehicleB = await request(app.getHttpServer())
      .post("/api/v1/vehicles")
      .set(auth(tenantB.accessToken))
      .send({
        ownerId: tenantB.userId,
        plateNumber: "01B222BB",
        model: "Man",
        capacity: 40,
      })
      .expect(201);
    vehicleBId = vehicleB.body.id;

    const contractB = await request(app.getHttpServer())
      .post("/api/v1/contracts")
      .set(auth(tenantB.accessToken))
      .send({
        vehicleId: vehicleBId,
        ownerId: tenantB.userId,
        type: "SELF_USE",
        startDate: "2026-10-01",
      })
      .expect(201);
    contractBId = contractB.body.id;
    await request(app.getHttpServer())
      .post(`/api/v1/contracts/${contractBId}/activate`)
      .set(auth(tenantB.accessToken))
      .expect(201);
  });

  afterAll(async () => {
    await app?.close();
    await admin?.$disconnect();
  });

  it("returns only the caller's tenant data through the API", async () => {
    const listA = await request(app.getHttpServer())
      .get("/api/v1/vehicles")
      .set(auth(tenantA.accessToken))
      .expect(200);
    expect(listA.body.items).toHaveLength(1);
    expect(listA.body.items[0].plateNumber).toBe("01A111AA");

    const listB = await request(app.getHttpServer())
      .get("/api/v1/vehicles")
      .set(auth(tenantB.accessToken))
      .expect(200);
    expect(listB.body.items).toHaveLength(1);
    expect(listB.body.items[0].plateNumber).toBe("01B222BB");

    await request(app.getHttpServer()).get("/api/v1/vehicles").expect(401);
  });

  it("blocks cross-tenant references attempted through the API", async () => {
    const contractAttempt = await request(app.getHttpServer())
      .post("/api/v1/contracts")
      .set(auth(tenantA.accessToken))
      .send({
        vehicleId: vehicleBId,
        ownerId: tenantB.userId,
        type: "SELF_USE",
        startDate: "2026-10-01",
      })
      .expect(400);
    expect(JSON.stringify(contractAttempt.body.message)).toMatch(/Avtomobil topilmadi/);

    await request(app.getHttpServer())
      .post("/api/v1/payments")
      .set(auth(tenantA.accessToken))
      .set("Idempotency-Key", "cross-tenant-attempt-001")
      .send({ contractId: contractBId, amount: "100.00", method: "MANUAL" })
      .expect(400);
  });

  it("returns zero rows without an explicit tenant context", async () => {
    expect(await countVisibleVehiclesWithoutTenant()).toBe(0);
  });

  it("scopes every query to the tenant set in the transaction", async () => {
    const [vehiclesA, companiesA, contractsA] = await Promise.all([
      asTenant(tenantA.tenantId, (tx) => tx.vehicle.count()),
      asTenant(tenantA.tenantId, (tx) => tx.company.findMany()),
      asTenant(tenantA.tenantId, (tx) => tx.contract.count()),
    ]);
    expect(vehiclesA).toBe(1);
    expect(companiesA.map((company) => company.id)).toEqual([tenantA.tenantId]);
    expect(contractsA).toBe(0);

    const vehiclesB = await asTenant(tenantB.tenantId, (tx) => tx.vehicle.count());
    expect(vehiclesB).toBe(1);
  });

  it("rejects a cross-tenant owner at the composite foreign key", async () => {
    await expect(
      asTenant(tenantA.tenantId, (tx) =>
        tx.vehicle.create({
          data: {
            tenantId: tenantA.tenantId,
            ownerId: tenantB.userId,
            plateNumber: "01X999XX",
            model: "Cross tenant",
            capacity: 1,
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it("rejects a payment whose contract belongs to another tenant", async () => {
    await expect(
      asTenant(tenantA.tenantId, (tx) =>
        tx.payment.create({
          data: {
            tenantId: tenantA.tenantId,
            contractId: contractBId,
            createdById: tenantA.userId,
            amount: "100.00",
            method: "MANUAL",
            status: "PENDING",
            idempotencyKey: "cross-tenant-payment-001",
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it("prevents inserting another tenant's Company row under RLS", async () => {
    await expect(
      asTenant(tenantA.tenantId, (tx) =>
        tx.company.create({
          data: {
            id: tenantB.tenantId,
            slug: "sneaky-company",
            name: "Sneaky",
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it("keeps the audit log append-only even for the database admin", async () => {
    const log = await admin.auditLog.findFirst({
      where: { tenantId: tenantA.tenantId },
      orderBy: { createdAt: "desc" },
    });
    expect(log).toBeTruthy();

    await expect(
      admin.$executeRawUnsafe(
        'UPDATE "AuditLog" SET action = $1 WHERE id = $2::uuid',
        "tampered",
        log!.id,
      ),
    ).rejects.toThrow(/append-only/);

    const client = new PrismaClient({ datasources: { db: { url: TEST_URL } } });
    try {
      const rows = await client.$queryRaw<Array<{ count: number }>>`
        SELECT COUNT(*)::int AS count FROM "AuditLog"
      `;
      expect(rows[0]?.count).toBe(0);
    } finally {
      await client.$disconnect();
    }
  });

  it("keeps vehicle and contract ids scoped to each tenant", async () => {
    expect(vehicleAId).not.toBe(vehicleBId);
    const paymentListB = await request(app.getHttpServer())
      .get("/api/v1/payments")
      .set(auth(tenantB.accessToken))
      .expect(200);
    expect(paymentListB.body.items).toHaveLength(0);
  });
});
