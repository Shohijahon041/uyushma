import { Module } from "@nestjs/common";
import {
  ExternalSettingsController,
  RegistryController,
} from "./external.controller";
import { ExternalInternalController } from "./external-internal.controller";
import { ExternalSyncQueueService } from "./external.queue";
import { ExternalService } from "./external.service";
import { OneIdAuthService } from "./connectors/oneid.service";
import { OneIdBrowserService } from "./connectors/oneid-browser.service";
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
    OneIdBrowserService,
    EImzoService,
    ExternalCrossLinkService,
  ],
  exports: [
    ExternalService,
    OneIdAuthService,
    OneIdBrowserService,
    EImzoService,
    ExternalCrossLinkService,
  ],
})
export class ExternalModule {}
