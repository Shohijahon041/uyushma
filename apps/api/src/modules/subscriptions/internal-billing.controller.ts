import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { IsUUID } from "class-validator";
import { Public } from "../../common/auth/decorators";
import { InternalApiGuard } from "../../common/auth/service-guards";
import { SubscriptionsService } from "./subscriptions.service";

class RunTenantBillingDto {
  @IsUUID()
  tenantId!: string;
}

/**
 * Called only by the background worker using a service key. The public API,
 * web app and bot cannot reach these routes without that key.
 */
@ApiExcludeController()
@Public()
@UseGuards(InternalApiGuard)
@Controller("internal/billing")
export class InternalBillingController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Post("run-all")
  runAll() {
    return this.subscriptions.runBillingForAllTenants();
  }

  @Post("run-tenant")
  runTenant(@Body() dto: RunTenantBillingDto) {
    return this.subscriptions.generateInvoiceForTenant(dto.tenantId, null);
  }

  @Post("run-reminders")
  runReminders() {
    return this.subscriptions.runSubscriptionReminders();
  }
}
