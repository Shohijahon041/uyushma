import { z } from "zod";

export const NOTIFICATION_QUEUE = "notifications";

export const notificationEventSchema = z.object({
  tenantId: z.string().uuid(),
  type: z.enum([
    "payment.paid",
    "payment.failed",
    "payment.refunded",
    "subscription.invoice_issued",
    "subscription.invoice_overdue",
    "subscription.trial_ending",
    "subscription.plan_changed",
    "system.test",
  ]),
  dedupeKey: z.string().min(8).max(160),
  occurredAt: z.string().datetime(),
  data: z
    .object({
      paymentId: z.string().uuid().optional(),
      invoiceId: z.string().uuid().optional(),
      subscriptionId: z.string().uuid().optional(),
      amount: z.string().optional(),
      plateNumber: z.string().optional(),
      number: z.string().optional(),
      planName: z.string().optional(),
      dueDate: z.string().optional(),
      text: z.string().max(1_000).optional(),
    })
    .default({}),
});

export type NotificationEvent = z.infer<typeof notificationEventSchema>;
export type NotificationEventType = NotificationEvent["type"];

const JOB_ID_SAFE = /[^A-Za-z0-9_-]/g;

export function notificationJobId(event: NotificationEvent): string {
  return `${event.type.replace(/\./g, "_")}__${event.dedupeKey}`.replace(
    JOB_ID_SAFE,
    "_",
  );
}
