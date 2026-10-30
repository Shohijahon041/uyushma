import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import type { ExternalProvider } from "@prisma/client";
import { Queue } from "bullmq";
import type { Redis } from "ioredis";
import { RedisService } from "../../common/redis/redis.module";

export const EXTERNAL_SYNC_QUEUE = "external-sync";

@Injectable()
export class ExternalSyncQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(ExternalSyncQueueService.name);
  private readonly queue: Queue;
  private readonly connection: Redis;

  constructor(redis: RedisService) {
    this.connection = redis.duplicate();
    this.queue = new Queue(EXTERNAL_SYNC_QUEUE, {
      connection: this.connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 30_000 },
        removeOnComplete: 200,
        removeOnFail: 500,
      },
    });
  }

  async enqueueSync(tenantId: string, provider: ExternalProvider): Promise<void> {
    try {
      await this.queue.add("external.sync", { tenantId, provider });
    } catch (error) {
      this.logger.error(
        `Sync navbatga qo'shilmadi (${provider}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
    this.connection.disconnect();
  }
}
