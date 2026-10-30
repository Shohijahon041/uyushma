import { INestApplication } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { signWebhookPayload } from "../../src/modules/payments/webhook-signature";
import {
  auth,
  bootstrapApp,
  createAdminClient,
  registerTenant,
  resetDatabase,
  type RegisteredTenant,
} from "./test-utils";

const PASSWORD = "StrongPass12345";

describe("Business flow: tariffs, payments, webhooks, refresh and RBAC", () => {
  let app: INestApplication;
  let admin: PrismaClient;
  let owner: RegisteredTenant;
  let vehicleId: string;
  let contractId: string;
  let tariffId: string;
  let routeId: string;

  beforeAll(async () => {
    admin = createAdminClient();
    await resetDatabase(admin);
    app = await bootstrapApp();
    owner = await registerTenant(app, "gamma-trans", "owner@gamma.uz", PASSWORD);

    const route = await request(app.getHttpServer())
      .post("/api/v1/routes")
      .set(auth(owner.accessToken))
      .send({
        name: "Toshkent-Buxoro",
        origin: "Toshkent",
        destination: "Buxoro",
        distanceKm: "600.00",
      })
      .expect(201);
    routeId = route.body.id;

    const tariff = await request(app.getHttpServer())
      .post("/api/v1/tariffs")
      .set(auth(owner.accessToken))
      .send({
        name: "Route corporate",
        scope: "ROUTE",
        routeId,
        baseAmount: "50000.00",
        pricePerKm: "900.00",
        rules: [
          { code: "NIGHT", label: "Night", operation: "ADD", amount: "25000.00", priority: 10 },
          { code: "CORP", label: "Corporate", operation: "OVERRIDE", amount: "300000.00", priority: 20 },
        ],
      })
      .expect(201);
    tariffId = tariff.body.id;

    const vehicle = await request(app.getHttpServer())
      .post("/api/v1/vehicles")
      .set(auth(owner.accessToken))
      .send({
        ownerId: owner.userId,
        plateNumber: "01G333GG",
        model: "Mercedes Sprinter",
        capacity: 18,
      })
      .expect(201);
    vehicleId = vehicle.body.id;

    const contract = await request(app.getHttpServer())
      .post("/api/v1/contracts")
      .set(auth(owner.accessToken))
      .send({
        vehicleId,
        ownerId: owner.userId,
        tariffId,
        type: "LEASE",
        startDate: "2026-10-01",
        monthlyRate: "1200000.00",
      })
      .expect(201);
    contractId = contract.body.id;
    await request(app.getHttpServer())
      .post(`/api/v1/contracts/${contractId}/activate`)
      .set(auth(owner.accessToken))
      .expect(201);
  });

  afterAll(async () => {
    await app?.close();
    await admin?.$disconnect();
  });

  it("calculates a route tariff on the server with Decimal arithmetic", async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/tariffs/${tariffId}/calculate`)
      .set(auth(owner.accessToken))
      .send({})
      .expect(201);

    expect(response.body.baseAmount).toBe("50000.00");
    expect(response.body.distanceCharge).toBe("540000.00");
    expect(response.body.subtotal).toBe("590000.00");
    expect(response.body.total).toBe("300000.00");
    expect(response.body.lines).toHaveLength(2);
  });

  it("makes manual payment creation idempotent", async () => {
    const key = "manual-payment-idem-001";
    const first = await request(app.getHttpServer())
      .post("/api/v1/payments")
      .set(auth(owner.accessToken))
      .set("Idempotency-Key", key)
      .send({ contractId, amount: "1250000.00", method: "MANUAL" })
      .expect(201);
    expect(first.body.idempotentReplay).toBe(false);

    const replay = await request(app.getHttpServer())
      .post("/api/v1/payments")
      .set(auth(owner.accessToken))
      .set("Idempotency-Key", key)
      .send({ contractId, amount: "1250000.00", method: "MANUAL" })
      .expect(201);
    expect(replay.body.idempotentReplay).toBe(true);
    expect(replay.body.payment.id).toBe(first.body.payment.id);

    const count = await admin.payment.count({
      where: { tenantId: owner.tenantId, idempotencyKey: key },
    });
    expect(count).toBe(1);

    await request(app.getHttpServer())
      .post("/api/v1/payments")
      .set(auth(owner.accessToken))
      .set("Idempotency-Key", key)
      .send({ contractId, amount: "9999.00", method: "MANUAL" })
      .expect(409);
  });

  it("accepts a signed webhook once and ignores duplicate delivery", async () => {
    const payment = await request(app.getHttpServer())
      .post("/api/v1/payments")
      .set(auth(owner.accessToken))
      .set("Idempotency-Key", "webhook-payment-001")
      .send({ contractId, amount: "500000.00", method: "AUTOMATIC" })
      .expect(201);
    const paymentId = payment.body.payment.id;

    const eventId = randomUUID();
    const rawBody = JSON.stringify({
      tenantSlug: owner.slug,
      eventId,
      paymentId,
      status: "PAID",
      amount: "500000.00",
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = signWebhookPayload(
      rawBody,
      timestamp,
      process.env.PAYMENT_WEBHOOK_SECRET!,
    );

    const first = await request(app.getHttpServer())
      .post("/api/v1/webhooks/payments/test-provider")
      .set("Content-Type", "application/json")
      .set("X-Webhook-Timestamp", timestamp)
      .set("X-Webhook-Signature", signature)
      .send(rawBody)
      .expect(200);
    expect(first.body.outcome).toBe("processed");

    const duplicate = await request(app.getHttpServer())
      .post("/api/v1/webhooks/payments/test-provider")
      .set("Content-Type", "application/json")
      .set("X-Webhook-Timestamp", timestamp)
      .set("X-Webhook-Signature", signature)
      .send(rawBody)
      .expect(200);
    expect(duplicate.body.outcome).toBe("idempotent");

    const payments = await request(app.getHttpServer())
      .get("/api/v1/payments")
      .set(auth(owner.accessToken))
      .expect(200);
    const updated = payments.body.items.find((item: { id: string }) => item.id === paymentId);
    expect(updated.status).toBe("PAID");

    const invalid = await request(app.getHttpServer())
      .post("/api/v1/webhooks/payments/test-provider")
      .set("Content-Type", "application/json")
      .set("X-Webhook-Timestamp", timestamp)
      .set("X-Webhook-Signature", signWebhookPayload(rawBody, timestamp, "wrong-secret"))
      .send(rawBody)
      .expect(401);
    expect(invalid.body.message).toMatch(/imzo/);
  });

  it("rejects a validly signed webhook whose amount differs", async () => {
    const payment = await request(app.getHttpServer())
      .post("/api/v1/payments")
      .set(auth(owner.accessToken))
      .set("Idempotency-Key", "webhook-mismatch-001")
      .send({ contractId, amount: "300000.00", method: "AUTOMATIC" })
      .expect(201);
    const rawBody = JSON.stringify({
      tenantSlug: owner.slug,
      eventId: randomUUID(),
      paymentId: payment.body.payment.id,
      status: "PAID",
      amount: "299999.00",
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = signWebhookPayload(
      rawBody,
      timestamp,
      process.env.PAYMENT_WEBHOOK_SECRET!,
    );

    await request(app.getHttpServer())
      .post("/api/v1/webhooks/payments/test-provider")
      .set("Content-Type", "application/json")
      .set("X-Webhook-Timestamp", timestamp)
      .set("X-Webhook-Signature", signature)
      .send(rawBody)
      .expect(400);
  });

  it("rotates refresh tokens and revokes the family on reuse", async () => {
    const login = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ companySlug: owner.slug, email: owner.email, password: PASSWORD })
      .expect(200);

    const rotated = await request(app.getHttpServer())
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: login.body.refreshToken })
      .expect(200);
    expect(rotated.body.refreshToken).not.toBe(login.body.refreshToken);

    await request(app.getHttpServer())
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: login.body.refreshToken })
      .expect(401);

    // Reuse detection revoked every active refresh token for this user.
    await request(app.getHttpServer())
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: rotated.body.refreshToken })
      .expect(401);
  });

  it("enforces RBAC for finance and fleet operations", async () => {
    const accountantEmail = "accountant@gamma.uz";
    const created = await request(app.getHttpServer())
      .post("/api/v1/users")
      .set(auth(owner.accessToken))
      .send({
        email: accountantEmail,
        fullName: "Gamma Accountant",
        password: PASSWORD,
        role: "ACCOUNTANT",
      })
      .expect(201);
    expect(created.body.role).toBe("ACCOUNTANT");

    const login = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ companySlug: owner.slug, email: accountantEmail, password: PASSWORD })
      .expect(200);

    await request(app.getHttpServer())
      .post("/api/v1/vehicles")
      .set(auth(login.body.accessToken))
      .send({
        ownerId: owner.userId,
        plateNumber: "01G444GG",
        model: "Denied",
        capacity: 1,
      })
      .expect(403);

    await request(app.getHttpServer())
      .get("/api/v1/payments")
      .set(auth(login.body.accessToken))
      .expect(200);

    await request(app.getHttpServer())
      .get("/api/v1/users")
      .set(auth(login.body.accessToken))
      .expect(403);
  });

  it("links a Telegram chat only through the bot API and a single-use token", async () => {
    const link = await request(app.getHttpServer())
      .post("/api/v1/settings/telegram/link-token")
      .set(auth(owner.accessToken))
      .send({})
      .expect(201);
    const token = link.body.token;
    const chatId = "8877665544";

    await request(app.getHttpServer())
      .post("/api/v1/integrations/telegram/link")
      .set("X-Bot-Api-Key", process.env.BOT_API_KEY!)
      .send({ token, chatId, username: "gamma_owner" })
      .expect(200);

    const summary = await request(app.getHttpServer())
      .get(`/api/v1/integrations/telegram/summary?chatId=${chatId}`)
      .set("X-Bot-Api-Key", process.env.BOT_API_KEY!)
      .expect(200);
    expect(summary.body.activeContracts).toBe(1);

    await request(app.getHttpServer())
      .get(`/api/v1/integrations/telegram/summary?chatId=${chatId}`)
      .expect(401);

    await request(app.getHttpServer())
      .post("/api/v1/integrations/telegram/link")
      .set("X-Bot-Api-Key", process.env.BOT_API_KEY!)
      .send({ token, chatId })
      .expect(401);
  });

  it("runs SaaS billing separately and requires the internal key", async () => {
    const current = await request(app.getHttpServer())
      .get("/api/v1/subscriptions/current")
      .set(auth(owner.accessToken))
      .expect(200);
    expect(current.body.subscription.planId).toBe("START");
    expect(current.body.subscription.status).toBe("TRIAL");

    // Active trial: no invoice is issued yet.
    await request(app.getHttpServer())
      .post("/api/v1/subscriptions/invoices/generate")
      .set(auth(owner.accessToken))
      .send({})
      .expect(400);

    await request(app.getHttpServer())
      .post("/api/v1/internal/billing/run-all")
      .send({})
      .expect(401);

    const internal = await request(app.getHttpServer())
      .post("/api/v1/internal/billing/run-all")
      .set("X-Internal-Api-Key", process.env.INTERNAL_API_KEY!)
      .send({})
      .expect(201);
    expect(internal.body.tenants).toBeGreaterThanOrEqual(1);
    expect(internal.body.failed).toBe(0);
  });

  it("records important operations in the append-only audit log", async () => {
    const audit = await request(app.getHttpServer())
      .get("/api/v1/audit?page=1&pageSize=100")
      .set(auth(owner.accessToken))
      .expect(200);
    const actions = audit.body.items.map((item: { action: string }) => item.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        "auth.company_registered",
        "contract.activated",
        "payment.created",
        "payment.webhook_processed",
        "telegram.linked",
      ]),
    );
  });

  it("rejects a second active contract for the same vehicle", async () => {
    const second = await request(app.getHttpServer())
      .post("/api/v1/contracts")
      .set(auth(owner.accessToken))
      .send({
        vehicleId,
        ownerId: owner.userId,
        type: "SELF_USE",
        startDate: "2026-10-15",
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/contracts/${second.body.id}/activate`)
      .set(auth(owner.accessToken))
      .expect(409);
  });
});
