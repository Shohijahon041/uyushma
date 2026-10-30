import { Injectable, Logger } from "@nestjs/common";
import {
  ThrottlerStorage,
  ThrottlerStorageService,
} from "@nestjs/throttler";
import type { ThrottlerStorageRecord } from "@nestjs/throttler/dist/throttler-storage-record.interface";
import type { Redis } from "ioredis";

const LUA = `
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then ttl = tonumber(ARGV[1]) end
local blockTtl = redis.call('PTTL', KEYS[2])
if blockTtl > 0 then
  return {hits, ttl, 1, blockTtl}
end
if hits > tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  return {hits, ttl, 1, tonumber(ARGV[3])}
end
return {hits, ttl, 0, 0}
`;

/**
 * Shared Redis counters make throttling correct across API replicas and
 * survive process restarts. If Redis is unreachable we degrade to the
 * in-memory storage instead of failing every request.
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private readonly memory = new ThrottlerStorageService();
  private warned = false;

  constructor(private readonly redis: Redis) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    if (this.redis.status !== "ready") {
      return this.memory.increment(key, ttl, limit, blockDuration, throttlerName);
    }
    const prefix = `rl:${throttlerName}:${key}`;
    try {
      const result = (await this.redis.eval(
        LUA,
        2,
        `${prefix}:hits`,
        `${prefix}:block`,
        String(ttl),
        String(limit),
        String(blockDuration),
      )) as Array<number | string>;
      const [totalHits, timeToExpire, isBlocked, timeToBlockExpire] = result.map(Number);
      return {
        totalHits: totalHits ?? 0,
        timeToExpire: timeToExpire ?? 0,
        isBlocked: (isBlocked ?? 0) === 1,
        timeToBlockExpire: timeToBlockExpire ?? 0,
      };
    } catch (error) {
      if (!this.warned) {
        this.warned = true;
        this.logger.warn(
          `Redis rate limit ishlamadi, xotiradagi hisoblagichga o'tildi: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      return this.memory.increment(key, ttl, limit, blockDuration, throttlerName);
    }
  }
}
