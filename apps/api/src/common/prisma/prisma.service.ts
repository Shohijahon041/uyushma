import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaClient } from "@prisma/client";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: ConfigService) {
    super({
      datasources: {
        db: {
          // DATABASE_URL must point to the limited application role so that
          // PostgreSQL RLS policies are enforced.
          url: config.getOrThrow<string>("DATABASE_URL"),
        },
      },
      log: config.get("NODE_ENV") === "development" ? ["warn", "error"] : ["error"],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    const role = await this.$queryRaw<Array<{ rolname: string; bypass: boolean; superuser: boolean }>>`
      SELECT rolname, rolbypassrls AS bypass, rolsuper AS superuser
      FROM pg_roles WHERE rolname = current_user
    `;
    const current = role[0];
    if (current?.bypass || current?.superuser) {
      this.logger.warn(
        `Database role "${current.rolname}" bypasses RLS. Never run the application with an admin role in production.`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
