import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiExcludeController, ApiTags } from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import { CurrentUser, Public, Roles } from "../../common/auth/decorators";
import { InternalApiGuard } from "../../common/auth/service-guards";
import type { AuthenticatedUser } from "../../common/auth/auth.types";
import { NotificationsService } from "./notifications.service";
import { NotificationsQueueService } from "./notifications.queue";

@ApiExcludeController()
@Public()
@UseGuards(InternalApiGuard)
@Controller("internal/notifications")
export class InternalNotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Post("dispatch")
  @HttpCode(200)
  dispatch(@Body() body: { event: unknown; jobId?: string }) {
    return this.notifications.dispatch(body.event, body.jobId ?? null);
  }
}

@ApiTags("notifications")
@ApiBearerAuth()
@Controller("notifications")
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly queue: NotificationsQueueService,
  ) {}

  @Get()
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.list(user.tenantId);
  }

  @Post("test")
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @HttpCode(202)
  async sendTest(@CurrentUser() user: AuthenticatedUser) {
    await this.queue.enqueue({
      tenantId: user.tenantId,
      type: "system.test",
      dedupeKey: `test__${user.userId}__${Date.now()}`,
      occurredAt: new Date().toISOString(),
      data: { text: "Staging bildirishnoma testi muvaffaqiyatli." },
    });
    return { queued: true };
  }
}
