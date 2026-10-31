import { Module } from "@nestjs/common";
import {
  ExternalSettingsController,
  RegistryController,
} from "./external.controller";
import { ExternalInternalController } from "./external-internal.controller";
import { ExternalSyncQueueService } from "./external.queue";
import { ExternalService } from "./external.service";
import { OneIdAuthService } from "./connectors/oneid.service";
import { EImzoService } from "./connectors/eimzo.service";
import { ExternalCrossLinkService } from "./cross-link.service";

@Module({
  controllers: [
    ExternalSettingsController,
    RegistryController,
    ExternalInternalController,
  ],
  providers: [
    ExternalService,
    ExternalSyncQueueService,
    OneIdAuthService,
    EImzoService,
    ExternalCrossLinkService,
  ],
  exports: [
    ExternalService,
    OneIdAuthService,
    EImzoService,
    ExternalCrossLinkService,
  ],
})
export class ExternalModule {}
