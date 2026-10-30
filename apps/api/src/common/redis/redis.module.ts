import {
  Global,
  Injectable,
  Logger,
  Module,
  OnModuleDestroy,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import IORedis, { type Redis } from "ioredis";

export const REDIS_CLIENT = Symbol("REDIS_CLIENT");

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;
  private warned = false;

  constructor(config: ConfigService) {
    this.client = new IORedis(config.getOrThrow<string>("REDIS_URL"), {
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
      enableOfflineQueue: false,
      lazyConnect: false,
      retryStrategy: (attempt) => Math.min(attempt * 200, 3_000),
    });
    this.client.on("error", (error) => {
      if (!this.warned) {
        this.warned = true;
        this.logger.warn(`Redis ulanish xatosi: ${error.message}`);
      }
    });
    this.client.on("ready", () => {
      this.warned = false;
      this.logger.log("Redis ulanishi tayyor");
    });
  }

  duplicate(): Redis {
    return this.client.duplicate({
      maxRetriesPerRequest: null,
      enableOfflineQueue: true,
    });
  }

  async ping(): Promise<boolean> {
    try {
      return (await this.client.ping()) === "PONG";
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit().catch(() => undefined);
  }
}

@Global()
@Module({
  providers: [
    RedisService,
    { provide: REDIS_CLIENT, useExisting: RedisService },
  ],
  exports: [RedisService, REDIS_CLIENT],
})
export class RedisModule {}
