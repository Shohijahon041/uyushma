DROP INDEX "PaymentWebhookEvent_provider_externalEventId_key";

CREATE UNIQUE INDEX "PaymentWebhookEvent_tenantId_provider_externalEventId_key"
  ON "PaymentWebhookEvent" ("tenantId", "provider", "externalEventId");
