import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Prisma, PrismaClient } from "@prisma/client";
import request from "supertest";
import { AppModule } from "../../src/app.module";
import { configureApp } from "../../src/bootstrap";

export const TEST_URL = process.env.TEST_DATABASE_URL!;
export const TEST_MIGRATE_URL = process.env.TEST_MIGRATE_DATABASE_URL!;

export interface RegisteredTenant {
  accessToken: string;
  refreshToken: string;
  tenantId: string;
  userId: string;
  email: string;
  slug: string;
}

export function createAdminClient(): PrismaClient {
  return new PrismaClient({
    datasources: { db: { url: TEST_MIGRATE_URL } },
  });
}

export async function bootstrapApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    logger: false,
  });
  configureApp(app);
  await app.init();
  return app;
}

export async function resetDatabase(admin: PrismaClient): Promise<void> {
  await admin.$executeRawUnsafe('TRUNCATE TABLE "Company" CASCADE');
  const plans = [
    {
      id: "START",
      name: "Start",
      monthlyPrice: new Prisma.Decimal("490000.00"),
      maxUsers: 5,
      maxVehicles: 25,
      features: { uz: ["test"] },
    },
    {
      id: "PRO",
      name: "Pro",
      monthlyPrice: new Prisma.Decimal("1290000.00"),
      maxUsers: 20,
      maxVehicles: 150,
      features: { uz: ["test"] },
    },
    {
      id: "ENTERPRISE",
      name: "Enterprise",
      monthlyPrice: new Prisma.Decimal("3490000.00"),
      maxUsers: 100,
      maxVehicles: 2000,
      features: { uz: ["test"] },
    },
  ];
  for (const plan of plans) {
    await admin.plan.upsert({
      where: { id: plan.id },
      create: plan,
      update: {
        name: plan.name,
        monthlyPrice: plan.monthlyPrice,
        maxUsers: plan.maxUsers,
        maxVehicles: plan.maxVehicles,
        features: plan.features,
      },
    });
  }
}

export async function registerTenant(
  app: INestApplication,
  slug: string,
  email = `owner@${slug}.uz`,
  password = "StrongPass12345",
): Promise<RegisteredTenant> {
  const response = await request(app.getHttpServer())
    .post("/api/v1/auth/register")
    .send({
      companyName: `${slug} Transport`,
      companySlug: slug,
      fullName: `${slug} Owner`,
      email,
      password,
    })
    .expect(201);

  return {
    accessToken: response.body.accessToken,
    refreshToken: response.body.refreshToken,
    tenantId: response.body.company.id,
    userId: response.body.user.id,
    email,
    slug,
  };
}

export function auth(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

/** Runs a callback as the limited app role with an explicit RLS tenant. */
export async function asTenant<T>(
  tenantId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const client = new PrismaClient({ datasources: { db: { url: TEST_URL } } });
  try {
    return await client.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        "SELECT set_config('app.tenant_id', $1::text, true)",
        tenantId,
      );
      return fn(tx);
    });
  } finally {
    await client.$disconnect();
  }
}

export async function countVisibleVehiclesWithoutTenant(): Promise<number> {
  const client = new PrismaClient({ datasources: { db: { url: TEST_URL } } });
  try {
    const rows = await client.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count FROM "Vehicle"
    `;
    return rows[0]?.count ?? -1;
  } finally {
    await client.$disconnect();
  }
}
