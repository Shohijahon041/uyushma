import "dotenv/config";
import { Queue, Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import { join } from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: join(process.cwd(), "../../.env") });
dotenv.config();

const REDIS_URL = process.env.REDIS_URL;
const API_URL = process.env.WORKER_API_URL ?? process.env.API_PUBLIC_URL;
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY;

if (!REDIS_URL || !API_URL || !INTERNAL_API_KEY) {
  console.error(
    "Worker: REDIS_URL, WORKER_API_URL va INTERNAL_API_KEY muhit o'zgaruvchilari majburiy",
  );
  process.exit(1);
}

const connection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

connection.on("error", (error) => {
  console.error("Worker Redis error:", error.message);
});

const BILLING_QUEUE = "billing";
const NOTIFICATION_QUEUE = "notifications";
const EXTERNAL_SYNC_QUEUE = "external-sync";

async function callInternal(path: string, body: unknown): Promise<unknown> {
  const response = await fetch(`${API_URL}/api/v1/internal/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Api-Key": INTERNAL_API_KEY!,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Internal API ${response.status}: ${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) : null;
}

async function processBillingJob(job: Job): Promise<unknown> {
  console.log(`[billing] job=${job.id} name=${job.name}`);
  if (job.name === "billing.run-all") {
    const result = await callInternal("billing/run-all", {});
    console.log("[billing] run-all", JSON.stringify(result));
    return result;
  }
  if (job.name === "billing.run-tenant") {
    const tenantId = (job.data as { tenantId?: string }).tenantId;
    if (!tenantId) throw new Error("tenantId missing");
    const result = await callInternal("billing/run-tenant", { tenantId });
    console.log(`[billing] tenant=${tenantId}`, JSON.stringify(result));
    return result;
  }
  if (job.name === "billing.run-reminders") {
    const result = await callInternal("billing/run-reminders", {});
    console.log("[billing] run-reminders", JSON.stringify(result));
    return result;
  }
  if (job.name === "payments.reconcile-all") {
    const result = await callInternal("payments/reconcile-all", {});
    console.log("[payments] reconcile-all", JSON.stringify(result));
    return result;
  }
  throw new Error(`Unknown job name: ${job.name}`);
}

async function processNotificationJob(job: Job): Promise<unknown> {
  const result = await callInternal("notifications/dispatch", {
    event: job.data,
    jobId: job.id,
  });
  console.log(
    `[notifications] job=${job.id} name=${job.name} result=${JSON.stringify(result)}`,
  );
  return result;
}

async function processExternalSyncJob(job: Job): Promise<unknown> {
  if (job.name === "external.sync-all") {
    const result = await callInternal("external/sync-all", {});
    console.log("[external] sync-all", JSON.stringify(result).slice(0, 2000));
    return result;
  }
  if (job.name === "external.sync") {
    const { tenantId, provider } = job.data as {
      tenantId?: string;
      provider?: string;
    };
    if (!tenantId || !provider) throw new Error("tenantId/provider missing");
    const result = await callInternal("external/sync", { tenantId, provider });
    console.log(`[external] tenant=${tenantId} provider=${provider}`, JSON.stringify(result));
    return result;
  }
  throw new Error(`Unknown job name: ${job.name}`);
}

async function main(): Promise<void> {
  const billingQueue = new Queue(BILLING_QUEUE, { connection });
  const billingWorker = new Worker(BILLING_QUEUE, processBillingJob, {
    connection,
    concurrency: 1,
  });

  const notificationQueue = new Queue(NOTIFICATION_QUEUE, { connection });
  const notificationWorker = new Worker(NOTIFICATION_QUEUE, processNotificationJob, {
    connection,
    concurrency: 5,
  });

  const externalQueue = new Queue(EXTERNAL_SYNC_QUEUE, { connection });
  const externalWorker = new Worker(EXTERNAL_SYNC_QUEUE, processExternalSyncJob, {
    connection,
    concurrency: 1,
  });

  billingWorker.on("failed", (job, error) => {
    console.error(`[billing] failed job=${job?.id} name=${job?.name}: ${error.message}`);
  });
  notificationWorker.on("failed", (job, error) => {
    console.error(
      `[notifications] failed job=${job?.id} name=${job?.name}: ${error.message}`,
    );
  });
  externalWorker.on("failed", (job, error) => {
    console.error(
      `[external] failed job=${job?.id} name=${job?.name}: ${error.message}`,
    );
  });
  externalWorker.on("error", (error) => {
    console.error("External worker error:", error.message);
  });
  billingWorker.on("error", (error) => {
    console.error("Billing worker error:", error.message);
  });
  notificationWorker.on("error", (error) => {
    console.error("Notification worker error:", error.message);
  });

  await billingQueue.upsertJobScheduler(
    "daily-billing",
    { pattern: "0 3 * * *", tz: "Asia/Tashkent" },
    {
      name: "billing.run-all",
      data: {},
      opts: {
        attempts: 3,
        backoff: { type: "exponential", delay: 60_000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    },
  );
  await billingQueue.upsertJobScheduler(
    "daily-reminders",
    { pattern: "0 9 * * *", tz: "Asia/Tashkent" },
    {
      name: "billing.run-reminders",
      data: {},
      opts: {
        attempts: 3,
        backoff: { type: "exponential", delay: 60_000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    },
  );
  await billingQueue.upsertJobScheduler(
    "daily-payment-reconciliation",
    { pattern: "0 4 * * *", tz: "Asia/Tashkent" },
    {
      name: "payments.reconcile-all",
      data: {},
      opts: {
        attempts: 3,
        backoff: { type: "exponential", delay: 120_000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    },
  );

  await externalQueue.upsertJobScheduler(
    "external-registry-sync",
    { pattern: "0 */6 * * *", tz: "Asia/Tashkent" },
    {
      name: "external.sync-all",
      data: {},
      opts: {
        attempts: 2,
        backoff: { type: "exponential", delay: 120_000 },
        removeOnComplete: 50,
        removeOnFail: 100,
      },
    },
  );

  console.log(
    "Worker started; billing 03:00, reconciliation 04:00, reminders 09:00, registry sync every 6h (Asia/Tashkent)",
  );

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Worker shutting down (${signal})...`);
    await Promise.all([
      billingWorker.close(),
      notificationWorker.close(),
      externalWorker.close(),
      billingQueue.close(),
      notificationQueue.close(),
      externalQueue.close(),
    ]);
    await connection.quit();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
  console.error("Worker failed to start", error);
  process.exit(1);
});
