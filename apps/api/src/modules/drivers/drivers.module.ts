import { Module } from "@nestjs/common";
import { BillingController, DriversController } from "./drivers.controller";
import { DriversService } from "./drivers.service";
import { TelegramFiles } from "./telegram-files";

@Module({
  controllers: [DriversController, BillingController],
  providers: [DriversService, TelegramFiles],
  exports: [DriversService],
})
export class DriversModule {}
