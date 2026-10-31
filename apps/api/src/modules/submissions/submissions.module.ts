import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { DocumentsModule } from "../documents/documents.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { FraudDetectorService } from "./fraud-detector.service";
import { SubmissionsController } from "./submissions.controller";
import { SubmissionsService } from "./submissions.service";

@Module({
  imports: [AuditModule, DocumentsModule, NotificationsModule],
  controllers: [SubmissionsController],
  providers: [SubmissionsService, FraudDetectorService],
  exports: [SubmissionsService, FraudDetectorService],
})
export class SubmissionsModule {}

