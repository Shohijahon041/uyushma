import { Module } from "@nestjs/common";
import { InternalApiGuard } from "../../common/auth/service-guards";
import { NotificationsModule } from "../notifications/notifications.module";
import { SubscriptionsController } from "./subscriptions.controller";
import { InternalBillingController } from "./internal-billing.controller";
import { SubscriptionsService } from "./subscriptions.service";

@Module({
  imports: [NotificationsModule],
  controllers: [SubscriptionsController, InternalBillingController],
  providers: [SubscriptionsService, InternalApiGuard],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
