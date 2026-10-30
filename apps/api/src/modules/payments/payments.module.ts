import { Module } from "@nestjs/common";
import {
  PaymentWebhooksController,
  PaymentsController,
} from "./payments.controller";
import { PaymeSettingsController, PaymeWebhookController } from "./payme.controller";
import { InternalPaymentsController } from "./payments.internal.controller";
import { PaymentsService } from "./payments.service";
import { PaymeService } from "./payme.service";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [NotificationsModule],
  // Payme's JSON-RPC route must be registered before the generic
  // /webhooks/payments/:provider route, otherwise "payme" is swallowed.
  controllers: [
    PaymentsController,
    PaymeSettingsController,
    PaymeWebhookController,
    InternalPaymentsController,
    PaymentWebhooksController,
  ],
  providers: [PaymentsService, PaymeService],
  exports: [PaymentsService, PaymeService],
})
export class PaymentsModule {}
