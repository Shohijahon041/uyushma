import { Module } from "@nestjs/common";
import { BotApiGuard } from "../../common/auth/service-guards";
import { DriversModule } from "../drivers/drivers.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { SubmissionsModule } from "../submissions/submissions.module";
import {
  TelegramBotController,
  TelegramSettingsController,
} from "./integrations.controller";
import { IntegrationsService } from "./integrations.service";

@Module({
  imports: [DriversModule, SubmissionsModule, NotificationsModule],
  controllers: [TelegramSettingsController, TelegramBotController],
  providers: [IntegrationsService, BotApiGuard],
})
export class IntegrationsModule {}
