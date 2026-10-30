import { ConfigService } from "@nestjs/config";
import { PaymentProvider } from "@prisma/client";
import { EncryptionService } from "../../common/crypto/encryption.service";
import { PaymeService } from "./payme.service";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";

function buildService(overrides: { account?: Record<string, unknown> | null } = {}) {
  const encryption = new EncryptionService(
    new ConfigService({ APP_ENCRYPTION_KEY: "payme-spec-key-0123456789abcdef012345" }),
  );
  const account =
    overrides.account === undefined
      ? {
          id: "account-1",
          tenantId: TENANT_ID,
          provider: PaymentProvider.PAYME,
          login: "Paycom",
          secretEncrypted: encryption.encrypt("secret-key"),
          webhookSecretEncrypted: null,
          isActive: true,
        }
      : overrides.account;

  const tx = {
    paymentProviderAccount: {
      findUnique: jest.fn().mockResolvedValue(account),
    },
  };
  const tenantPrisma = {
    resolveTenantIdBySlug: jest.fn().mockResolvedValue(TENANT_ID),
    resolvePaymentTenant: jest.fn().mockResolvedValue(TENANT_ID),
    withTenant: jest.fn((_tenantId: string, run: (client: unknown) => unknown) => run(tx)),
  };
  const metrics = { providerOperations: { inc: jest.fn() } };
  const service = new PaymeService(
    tenantPrisma as never,
    encryption,
    { log: jest.fn() } as never,
    new ConfigService({}),
    { enqueue: jest.fn() } as never,
    metrics as never,
  );
  const dispatch = jest
    .spyOn(
      service as unknown as { dispatchMethod: (...args: unknown[]) => Promise<unknown> },
      "dispatchMethod",
    )
    .mockImplementation((...args: unknown[]) => {
      const id = args[2] as string | number | null;
      return Promise.resolve({ jsonrpc: "2.0", id, result: { state: 1 } });
    });
  return { service, tenantPrisma, metrics, dispatch, encryption };
}

function authHeader(login: string, secret: string): string {
  return `Basic ${Buffer.from(`${login}:${secret}`).toString("base64")}`;
}

describe("PaymeService.handleRpc", () => {
  it("buzilgan JSON uchun parse xatosini qaytaradi", async () => {
    const { service } = buildService();
    const response = await service.handleRpc({
      tenantSlug: "acme",
      rawBody: "{not-json",
      authorization: undefined,
      ip: null,
    });

    expect(response).toMatchObject({ error: { code: -32700 } });
  });

  it("notanish tenant uchun avtorizatsiya xatosini qaytaradi", async () => {
    const { service, tenantPrisma } = buildService();
    tenantPrisma.resolveTenantIdBySlug.mockResolvedValue(null);
    const response = await service.handleRpc({
      tenantSlug: "yoq",
      rawBody: JSON.stringify({ id: 2, method: "CheckPerformTransaction", params: {} }),
      authorization: authHeader("Paycom", "secret-key"),
      ip: null,
    });

    expect(response).toMatchObject({ id: 2, error: { code: -32504 } });
  });

  it("Basic auth noto'g'ri bo'lsa so'rovni rad etadi", async () => {
    const { service, dispatch } = buildService();
    const response = await service.handleRpc({
      tenantSlug: "acme",
      rawBody: JSON.stringify({ id: 3, method: "CheckPerformTransaction", params: {} }),
      authorization: authHeader("Paycom", "wrong"),
      ip: null,
    });

    expect(response).toMatchObject({ error: { code: -32504 } });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("to'g'ri Basic auth bilan metodni bajaradi", async () => {
    const { service, dispatch, metrics } = buildService();
    const response = await service.handleRpc({
      tenantSlug: "acme",
      rawBody: JSON.stringify({
        id: 4,
        method: "CheckPerformTransaction",
        params: { amount: 100000, account: { order_id: "order-1" } },
      }),
      authorization: authHeader("Paycom", "secret-key"),
      ip: "127.0.0.1",
    });

    expect(response).toEqual({ jsonrpc: "2.0", id: 4, result: { state: 1 } });
    expect(dispatch).toHaveBeenCalledWith(
      expect.anything(),
      TENANT_ID,
      4,
      "CheckPerformTransaction",
      expect.objectContaining({ amount: 100000 }),
    );
    expect(metrics.providerOperations.inc).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "PAYME", status: "ok" }),
    );
  });

  it("tenant slug berilmasa order_id orqali tenantni topadi", async () => {
    const { service, tenantPrisma } = buildService();
    await service.handleRpc({
      tenantSlug: null,
      rawBody: JSON.stringify({
        id: 5,
        method: "GetStatement",
        params: { account: { order_id: "order-9" } },
      }),
      authorization: authHeader("Paycom", "secret-key"),
      ip: null,
    });

    expect(tenantPrisma.resolvePaymentTenant).toHaveBeenCalledWith("order-9");
  });

  it("noaktiv hisob bilan ishlamaydi", async () => {
    const { service, dispatch } = buildService({
      account: {
        id: "account-1",
        tenantId: TENANT_ID,
        login: "Paycom",
        secretEncrypted: "v1.x.y.z",
        webhookSecretEncrypted: null,
        isActive: false,
      },
    });
    const response = await service.handleRpc({
      tenantSlug: "acme",
      rawBody: JSON.stringify({ id: 6, method: "CheckTransaction", params: {} }),
      authorization: authHeader("Paycom", "secret-key"),
      ip: null,
    });

    expect(response).toMatchObject({ error: { code: -32504 } });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("HMAC rejimida per-tenant webhook sirini qabul qiladi", async () => {
    const encryption = new EncryptionService(
      new ConfigService({ APP_ENCRYPTION_KEY: "payme-spec-key-0123456789abcdef012345" }),
    );
    const { service } = buildService({
      account: {
        id: "account-1",
        tenantId: TENANT_ID,
        login: "Paycom",
        secretEncrypted: encryption.encrypt("secret-key"),
        webhookSecretEncrypted: encryption.encrypt("hmac-secret"),
        isActive: true,
      },
    });
    const response = await service.handleRpc({
      tenantSlug: "acme",
      rawBody: JSON.stringify({ id: 7, method: "CheckTransaction", params: {} }),
      authorization: "HMAC hmac-secret",
      ip: null,
    });

    expect(response).toEqual({ jsonrpc: "2.0", id: 7, result: { state: 1 } });
  });
});
