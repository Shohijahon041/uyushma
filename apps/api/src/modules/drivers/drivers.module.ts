import { Module } from "@nestjs/common";
import { NotificationsModule } from "../notifications/notifications.module";
import { BillingController, DriversController } from "./drivers.controller";
import { DriversService } from "./drivers.service";
import { TelegramFiles } from "./telegram-files";

@Module({
  imports: [NotificationsModule],
  controllers: [DriversController, BillingController],
  providers: [DriversService, TelegramFiles],
  exports: [DriversService],
})
export class DriversModule {}
