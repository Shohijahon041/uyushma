import { Module } from "@nestjs/common";
import { BotApiGuard } from "../../common/auth/service-guards";
import { DriversModule } from "../drivers/drivers.module";
import {
  TelegramBotController,
  TelegramSettingsController,
} from "./integrations.controller";
import { IntegrationsService } from "./integrations.service";

@Module({
  imports: [DriversModule],
  controllers: [TelegramSettingsController, TelegramBotController],
  providers: [IntegrationsService, BotApiGuard],
})
export class IntegrationsModule {}
