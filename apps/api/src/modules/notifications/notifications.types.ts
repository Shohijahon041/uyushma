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
    "driver.payment_received",
    "driver.debt_reminder",
    "vehicle.license_expiring",
  ]),
  dedupeKey: z.string().min(8).max(160),
  occurredAt: z.string().datetime(),
  data: z
    .object({
      paymentId: z.string().uuid().optional(),
      driverPaymentId: z.string().uuid().optional(),
      driverId: z.string().uuid().optional(),
      vehicleId: z.string().uuid().optional(),
      invoiceId: z.string().uuid().optional(),
      subscriptionId: z.string().uuid().optional(),
      amount: z.string().optional(),
      plateNumber: z.string().optional(),
      model: z.string().optional(),
      driverName: z.string().optional(),
      receivedByName: z.string().optional(),
      method: z.string().optional(),
      paidMonth: z.string().optional(),
      paidTotal: z.string().optional(),
      debtAmount: z.string().optional(),
      planAmount: z.string().optional(),
      licenseNumber: z.string().optional(),
      expiresAt: z.string().optional(),
      daysLeft: z.number().optional(),
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
