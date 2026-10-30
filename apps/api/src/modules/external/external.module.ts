import { Module } from "@nestjs/common";
import {
  ExternalSettingsController,
  RegistryController,
} from "./external.controller";
import { ExternalInternalController } from "./external-internal.controller";
import { ExternalSyncQueueService } from "./external.queue";
import { ExternalService } from "./external.service";

@Module({
  controllers: [
    ExternalSettingsController,
    RegistryController,
    ExternalInternalController,
  ],
  providers: [ExternalService, ExternalSyncQueueService],
  exports: [ExternalService],
})
export class ExternalModule {}
