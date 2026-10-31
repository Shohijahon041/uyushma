import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Prisma, PrismaClient } from "@prisma/client";
import { hash } from "@node-rs/argon2";
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
  phone: string;
  slug: string;
}

const ARGON_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1, outputLen: 32 };

export function createAdminClient(): PrismaClient {
  return new PrismaClient({
    datasources: { db: { url: TEST_MIGRATE_URL } },
  });
}

export async function bootstrapApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
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

const PLATFORM_PHONE = "+998900000000";
const PLATFORM_PASSWORD = "PlatformPass12345";
let phoneSequence = 0;

export function nextTestPhone(): string {
  phoneSequence += 1;
  return `+99891${String(phoneSequence).padStart(7, "0")}`;
}

/** Super admin faqat platforma tenantida yashaydi; korxonalarni u yaratadi. */
async function platformAdminToken(app: INestApplication): Promise<string> {
  const admin = createAdminClient();
  try {
    const existing = await admin.user.findUnique({ where: { phone: PLATFORM_PHONE } });
    if (!existing) {
      const company = await admin.company.create({
        data: { slug: "platforma", name: "Platforma", isPlatform: true },
      });
      await admin.user.create({
        data: {
          tenantId: company.id,
          phone: PLATFORM_PHONE,
          fullName: "Platform Admin",
          passwordHash: await hash(PLATFORM_PASSWORD, ARGON_OPTIONS),
          role: "OWNER",
          isSuperAdmin: true,
        },
      });
    }
  } finally {
    await admin.$disconnect();
  }
  const login = await request(app.getHttpServer())
    .post("/api/v1/auth/login")
    .send({ phone: PLATFORM_PHONE, password: PLATFORM_PASSWORD })
    .expect(200);
  return login.body.accessToken;
}

export async function registerTenant(
  app: INestApplication,
  slug: string,
  phone = nextTestPhone(),
  password = "StrongPass12345",
): Promise<RegisteredTenant> {
  const adminToken = await platformAdminToken(app);
  await request(app.getHttpServer())
    .post("/api/v1/platform/companies")
    .set(auth(adminToken))
    .send({
      companyName: `${slug} Transport`,
      companySlug: slug,
      ownerFullName: `${slug} Owner`,
      ownerPhone: phone,
      password,
    })
    .expect(201);

  const response = await request(app.getHttpServer())
    .post("/api/v1/auth/login")
    .send({ phone, password })
    .expect(200);

  return {
    accessToken: response.body.accessToken,
    refreshToken: response.body.refreshToken,
    tenantId: response.body.company.id,
    userId: response.body.user.id,
    phone,
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
