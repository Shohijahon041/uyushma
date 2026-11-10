import { Module } from "@nestjs/common";
import { WaybillsController } from "./waybills.controller";
import { WaybillsService } from "./waybills.service";

@Module({
  controllers: [WaybillsController],
  providers: [WaybillsService],
  exports: [WaybillsService],
})
export class WaybillsModule {}
