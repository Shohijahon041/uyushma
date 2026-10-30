import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Queue } from "bullmq";
import type { Redis } from "ioredis";
import { RedisService } from "../../common/redis/redis.module";
import { MetricsService } from "../../common/metrics/metrics.module";
import {
  NOTIFICATION_QUEUE,
  notificationJobId,
  type NotificationEvent,
} from "./notifications.types";

@Injectable()
export class NotificationsQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(NotificationsQueueService.name);
  private readonly queue: Queue<NotificationEvent> | null;
  private readonly connection: Redis | null;

  constructor(
    private readonly config: ConfigService,
    redis: RedisService,
    private readonly metrics: MetricsService,
  ) {
    const enabled = config.get<boolean>("NOTIFICATIONS_ENABLED", true);
    if (!enabled) {
      this.queue = null;
      this.connection = null;
      this.logger.warn("Bildirishnomalar o'chirilgan (NOTIFICATIONS_ENABLED=false)");
      return;
    }
    this.connection = redis.duplicate();
    this.queue = new Queue<NotificationEvent>(NOTIFICATION_QUEUE, {
      connection: this.connection,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: 1_000,
        removeOnFail: 5_000,
      },
    });
  }

  async enqueue(event: NotificationEvent): Promise<void> {
    if (!this.queue) return;
    const jobId = notificationJobId(event);
    try {
      // Idempotent: BullMQ ignores duplicate job ids, so webhook retries and
      // worker restarts cannot notify the same tenant twice.
      await this.queue.add(event.type, event, { jobId });
      this.metrics.notificationDispatches.inc({ event: event.type, status: "queued" });
    } catch (error) {
      this.metrics.notificationDispatches.inc({ event: event.type, status: "queue_failed" });
      this.logger.error(
        `Bildirishnoma navbatga qo'shilmadi (${event.type}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
    this.connection?.disconnect();
  }
}
