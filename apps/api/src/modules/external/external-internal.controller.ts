import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { IsIn, IsUUID } from "class-validator";
import { Public } from "../../common/auth/decorators";
import { InternalApiGuard } from "../../common/auth/service-guards";
import { ExternalService } from "./external.service";

class RunSyncDto {
  @IsUUID()
  tenantId!: string;

  @IsIn(["ETENDER", "AUTOPARK", "IJARA"])
  provider!: "ETENDER" | "AUTOPARK" | "IJARA";
}

/**
 * Worker-only endpoints. Reachable only with X-Internal-Api-Key.
 */
@ApiExcludeController()
@Public()
@UseGuards(InternalApiGuard)
@Controller("internal/external")
export class ExternalInternalController {
  constructor(private readonly external: ExternalService) {}

  @Post("sync")
  sync(@Body() dto: RunSyncDto) {
    return this.external.syncConnection(dto.tenantId, dto.provider);
  }

  @Post("sync-all")
  syncAll() {
    return this.external.syncAll();
  }
}
