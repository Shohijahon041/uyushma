import { Module } from "@nestjs/common";
import {
  ExternalSettingsController,
  RegistryController,
} from "./external.controller";
import { ExternalInternalController } from "./external-internal.controller";
import { LocalConnectorController } from "./local-connector.controller";
import { LocalConnectorService } from "./local-connector.service";
import { CollectorController } from "./collector.controller";
import { ExternalSyncQueueService } from "./external.queue";
import { ExternalService } from "./external.service";
import { OneIdAuthService } from "./connectors/oneid.service";
import { OneIdBrowserService } from "./connectors/oneid-browser.service";
import { EImzoService } from "./connectors/eimzo.service";
import { ExternalCrossLinkService } from "./cross-link.service";
import { CollectorService } from "./collector.service";

@Module({
  controllers: [
    ExternalSettingsController,
    RegistryController,
    ExternalInternalController,
    LocalConnectorController,
    CollectorController,
  ],
  providers: [
    ExternalService,
    ExternalSyncQueueService,
    OneIdAuthService,
    OneIdBrowserService,
    EImzoService,
    ExternalCrossLinkService,
    CollectorService,
    LocalConnectorService,
  ],
  exports: [
    ExternalService,
    OneIdAuthService,
    OneIdBrowserService,
    EImzoService,
    ExternalCrossLinkService,
    CollectorService,
    LocalConnectorService,
  ],
})
export class ExternalModule {}
