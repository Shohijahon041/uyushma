import { Module } from "@nestjs/common";
import {
  InternalNotificationsController,
  NotificationsController,
} from "./notifications.controller";
import { NotificationsService } from "./notifications.service";
import { NotificationsQueueService } from "./notifications.queue";
import { TelegramNotifier } from "./telegram.notifier";

@Module({
  controllers: [InternalNotificationsController, NotificationsController],
  providers: [NotificationsService, NotificationsQueueService, TelegramNotifier],
  exports: [NotificationsService, NotificationsQueueService, TelegramNotifier],
})
export class NotificationsModule {}
