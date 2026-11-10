import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { ThrottlerModule } from "@nestjs/throttler";
import { join } from "node:path";
import { validateEnv } from "./config/env.validation";
import { DataModule } from "./common/data.module";
import { RedisModule, RedisService } from "./common/redis/redis.module";
import { RedisThrottlerStorage } from "./common/redis/redis-throttler.storage";
import { MetricsModule } from "./common/metrics/metrics.module";
import { CryptoModule } from "./common/crypto/crypto.module";
import { AppThrottlerGuard } from "./common/auth/app-throttler.guard";
import { JwtAuthGuard } from "./common/auth/jwt-auth.guard";
import { RolesGuard } from "./common/auth/roles.guard";
import { AuditModule } from "./modules/audit/audit.module";
import { AuthModule } from "./modules/auth/auth.module";
import { NotificationsModule } from "./modules/notifications/notifications.module";
import { UsersModule } from "./modules/users/users.module";
import { VehiclesModule } from "./modules/vehicles/vehicles.module";
import { RoutesModule } from "./modules/routes/routes.module";
import { TariffsModule } from "./modules/tariffs/tariffs.module";
import { ContractsModule } from "./modules/contracts/contracts.module";
import { PaymentsModule } from "./modules/payments/payments.module";
import { SubscriptionsModule } from "./modules/subscriptions/subscriptions.module";
import { DashboardModule } from "./modules/dashboard/dashboard.module";
import { DocumentsModule } from "./modules/documents/documents.module";
import { IntegrationsModule } from "./modules/integrations/integrations.module";
import { ExternalModule } from "./modules/external/external.module";
import { DriversModule } from "./modules/drivers/drivers.module";
import { PlatformModule } from "./modules/platform/platform.module";
import { SubmissionsModule } from "./modules/submissions/submissions.module";
import { HealthModule } from "./modules/health/health.module";
import { WaybillsModule } from "./modules/waybills/waybills.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: false,
      envFilePath: [
        join(process.cwd(), "../../.env"),
        join(process.cwd(), ".env"),
      ],
      validate: validateEnv,
    }),
    JwtModule.register({ global: true }),
    ThrottlerModule.forRootAsync({
      imports: [RedisModule],
      inject: [RedisService],
      useFactory: (redis: RedisService) => ({
        storage: new RedisThrottlerStorage(redis.client),
        throttlers: [{ ttl: 60_000, limit: 120 }],
      }),
    }),
    RedisModule,
    MetricsModule,
    CryptoModule,
    DataModule,
    AuditModule,
    NotificationsModule,
    AuthModule,
    UsersModule,
    VehiclesModule,
    RoutesModule,
    TariffsModule,
    ContractsModule,
    PaymentsModule,
    SubscriptionsModule,
    DashboardModule,
    DocumentsModule,
    IntegrationsModule,
    ExternalModule,
    DriversModule,
    PlatformModule,
    SubmissionsModule,
    HealthModule,
    WaybillsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
