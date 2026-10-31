-- ============================================================================
-- Masofaviy to'lov arizalari (chek skrinshotlari) va AI soxtalik himoyasi.
-- Har bir ariza tenantga tegishli, RLS bilan himoyalangan.
-- App rolidan DELETE huquqi olib tashlangan.
-- ============================================================================

CREATE TYPE "PaymentSubmissionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE "FraudRiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- Kompaniya karta va to'lov rekvizitlari
ALTER TABLE "Company" ADD COLUMN "paymentCardNumber" VARCHAR(32);
ALTER TABLE "Company" ADD COLUMN "paymentCardHolder" VARCHAR(120);
ALTER TABLE "Company" ADD COLUMN "paymentCardBank" VARCHAR(120);
ALTER TABLE "Company" ADD COLUMN "paymentInstructions" VARCHAR(500);

-- To'lov arizalari (chek skrinshotlari)
CREATE TABLE "PaymentSubmission" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "driverId" UUID NOT NULL,
  "vehicleId" UUID NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,
  "periodStart" DATE NOT NULL,
  "receiptFileKey" VARCHAR(512) NOT NULL,
  "receiptFileUrl" VARCHAR(1024),
  "transactionNumber" VARCHAR(120),
  "imageHash" VARCHAR(64),
  "status" "PaymentSubmissionStatus" NOT NULL DEFAULT 'PENDING',
  "fraudRisk" "FraudRiskLevel" NOT NULL DEFAULT 'LOW',
  "fraudScore" INTEGER NOT NULL DEFAULT 0,
  "fraudFlags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "fraudAnalysis" JSONB,
  "note" VARCHAR(500),
  "reviewedById" UUID,
  "reviewedAt" TIMESTAMP(3),
  "rejectReason" VARCHAR(500),
  "driverPaymentId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PaymentSubmission_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PaymentSubmission_driverPaymentId_key" UNIQUE ("driverPaymentId")
);

-- Indekslar
CREATE UNIQUE INDEX "PaymentSubmission_id_tenantId_key" ON "PaymentSubmission"("id", "tenantId");
CREATE INDEX "PaymentSubmission_tenantId_status_idx" ON "PaymentSubmission"("tenantId", "status");
CREATE INDEX "PaymentSubmission_tenantId_createdAt_idx" ON "PaymentSubmission"("tenantId", "createdAt");
CREATE INDEX "PaymentSubmission_tenantId_driverId_idx" ON "PaymentSubmission"("tenantId", "driverId");
CREATE INDEX "PaymentSubmission_imageHash_idx" ON "PaymentSubmission"("imageHash");
CREATE INDEX "PaymentSubmission_transactionNumber_idx" ON "PaymentSubmission"("transactionNumber");

-- Foreign keylar
ALTER TABLE "PaymentSubmission" ADD CONSTRAINT "PaymentSubmission_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentSubmission" ADD CONSTRAINT "PaymentSubmission_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentSubmission" ADD CONSTRAINT "PaymentSubmission_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentSubmission" ADD CONSTRAINT "PaymentSubmission_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PaymentSubmission" ADD CONSTRAINT "PaymentSubmission_driverPaymentId_fkey" FOREIGN KEY ("driverPaymentId") REFERENCES "DriverPayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Cross-tenant izolyatsiyasi
ALTER TABLE "PaymentSubmission"
  ADD CONSTRAINT "PaymentSubmission_driver_tenant_fkey"
  FOREIGN KEY ("driverId", "tenantId") REFERENCES "Driver"("id", "tenantId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PaymentSubmission"
  ADD CONSTRAINT "PaymentSubmission_vehicle_tenant_fkey"
  FOREIGN KEY ("vehicleId", "tenantId") REFERENCES "Vehicle"("id", "tenantId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row Level Security
ALTER TABLE "PaymentSubmission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentSubmission" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_paymentsubmission ON "PaymentSubmission"
  USING ("tenantId" = app_current_tenant_id())
  WITH CHECK ("tenantId" = app_current_tenant_id());

-- Huquqlar (DELETE taqiqlangan)
GRANT SELECT, INSERT, UPDATE ON "PaymentSubmission" TO uyushma_app;

