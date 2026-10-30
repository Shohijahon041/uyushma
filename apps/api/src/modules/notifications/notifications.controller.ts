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

  @Post("run-reminders")
  @HttpCode(200)
  runReminders() {
    return this.notifications.runRemindersForAllTenants();
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
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.ACCOUNTANT)
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.list(user.tenantId);
  }

  @Post("run-reminders")
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @HttpCode(200)
  runReminders() {
    return this.notifications.runRemindersForAllTenants();
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
      data: { text: "Bildirishnomalar tizimi muvaffaqiyatli ishlayapti." },
    });
    return { queued: true };
  }
}
