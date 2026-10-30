import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Public } from "../../common/auth/decorators";
import { TenantPrismaService } from "../../common/prisma/tenant-prisma.service";
import { RedisService } from "../../common/redis/redis.module";

@ApiTags("health")
@Controller()
export class HealthController {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly redis: RedisService,
  ) {}

  @Public()
  @Get("health/live")
  live() {
    return { status: "ok", uptime: process.uptime() };
  }

  @Public()
  @Get("health/ready")
  async ready() {
    try {
      await this.tenantPrisma.ping();
    } catch {
      throw new ServiceUnavailableException("Ma'lumotlar bazasi javob bermayapti");
    }
    const redisUp = await this.redis.ping();
    return {
      status: redisUp ? "ok" : "degraded",
      database: "up",
      redis: redisUp ? "up" : "down",
      timestamp: new Date().toISOString(),
    };
  }
}
