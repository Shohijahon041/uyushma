import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { PaymentProvider } from "@prisma/client";
import { Public } from "../../common/auth/decorators";
import { InternalApiGuard } from "../../common/auth/service-guards";
import { PaymeService } from "./payme.service";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseRange(body: { from?: unknown; to?: unknown }): { from: Date; to: Date } {
  const to = body.to ? new Date(String(body.to)) : new Date();
  const from = body.from
    ? new Date(String(body.from))
    : new Date(to.getTime() - 24 * 60 * 60 * 1000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new BadRequestException("Davr sanalari yaroqsiz");
  }
  return { from, to };
}

@ApiExcludeController()
@Public()
@UseGuards(InternalApiGuard)
@Controller("internal/payments")
export class InternalPaymentsController {
  constructor(private readonly payme: PaymeService) {}

  @Post("reconcile-all")
  @HttpCode(200)
  reconcileAll(@Body() body: { from?: unknown; to?: unknown }) {
    return this.payme.runReconciliationForAllTenants(parseRange(body));
  }

  @Post("reconcile-tenant")
  @HttpCode(200)
  reconcileTenant(
    @Body()
    body: {
      tenantId?: unknown;
      provider?: unknown;
      from?: unknown;
      to?: unknown;
    },
  ) {
    const tenantId = typeof body.tenantId === "string" ? body.tenantId : "";
    if (!UUID_RE.test(tenantId)) {
      throw new BadRequestException("tenantId yaroqsiz");
    }
    const provider =
      body.provider === undefined ? PaymentProvider.PAYME : body.provider;
    if (!Object.values(PaymentProvider).includes(provider as PaymentProvider)) {
      throw new BadRequestException("provider yaroqsiz");
    }
    return this.payme.runReconciliation(
      tenantId,
      provider as PaymentProvider,
      parseRange(body),
    );
  }
}
