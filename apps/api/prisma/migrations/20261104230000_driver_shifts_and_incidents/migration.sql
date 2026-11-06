-- ============================================================================
-- Haydovchilar smenalari (smenaga chiqish/yakunlash) va texnik nosozliklar (SOS).
-- Har bir yozuv tegishli tenantga bog'langan va Row Level Security bilan himoyalangan.
-- ============================================================================

CREATE TYPE "ShiftStatus" AS ENUM ('ACTIVE', 'COMPLETED');
CREATE TYPE "IncidentStatus" AS ENUM ('OPEN', 'RESOLVED');

-- 1. Haydovchilar smenasi (yo'nalishga chiqish va spidometr ko'rsatkichlari)
CREATE TABLE "DriverShift" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "driverId" UUID NOT NULL,
  "vehicleId" UUID NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" TIMESTAMP(3),
  "startOdometer" INTEGER,
  "endOdometer" INTEGER,
  "status" "ShiftStatus" NOT NULL DEFAULT 'ACTIVE',
  "note" VARCHAR(300),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DriverShift_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DriverShift_id_tenantId_key" ON "DriverShift"("id", "tenantId");
CREATE INDEX "DriverShift_tenantId_status_startedAt_idx" ON "DriverShift"("tenantId", "status", "startedAt");
CREATE INDEX "DriverShift_tenantId_driverId_status_idx" ON "DriverShift"("tenantId", "driverId", "status");

ALTER TABLE "DriverShift" ADD CONSTRAINT "DriverShift_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DriverShift" ADD CONSTRAINT "DriverShift_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DriverShift" ADD CONSTRAINT "DriverShift_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Cross-tenant izolyatsiyasi
ALTER TABLE "DriverShift"
  ADD CONSTRAINT "DriverShift_driver_tenant_fkey"
  FOREIGN KEY ("driverId", "tenantId") REFERENCES "Driver"("id", "tenantId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DriverShift"
  ADD CONSTRAINT "DriverShift_vehicle_tenant_fkey"
  FOREIGN KEY ("vehicleId", "tenantId") REFERENCES "Vehicle"("id", "tenantId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row Level Security
ALTER TABLE "DriverShift" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DriverShift" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_drivershift ON "DriverShift"
  USING ("tenantId" = app_current_tenant_id())
  WITH CHECK ("tenantId" = app_current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON "DriverShift" TO uyushma_app;


-- 2. Haydovchilar nosozlik va favqulodda hodisa xabarlari (SOS)
CREATE TABLE "DriverIncident" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "driverId" UUID NOT NULL,
  "vehicleId" UUID NOT NULL,
  "kind" VARCHAR(80) NOT NULL,
  "description" VARCHAR(500),
  "status" "IncidentStatus" NOT NULL DEFAULT 'OPEN',
  "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DriverIncident_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DriverIncident_id_tenantId_key" ON "DriverIncident"("id", "tenantId");
CREATE INDEX "DriverIncident_tenantId_status_reportedAt_idx" ON "DriverIncident"("tenantId", "status", "reportedAt");
CREATE INDEX "DriverIncident_tenantId_driverId_idx" ON "DriverIncident"("tenantId", "driverId");

ALTER TABLE "DriverIncident" ADD CONSTRAINT "DriverIncident_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DriverIncident" ADD CONSTRAINT "DriverIncident_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DriverIncident" ADD CONSTRAINT "DriverIncident_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Cross-tenant izolyatsiyasi
ALTER TABLE "DriverIncident"
  ADD CONSTRAINT "DriverIncident_driver_tenant_fkey"
  FOREIGN KEY ("driverId", "tenantId") REFERENCES "Driver"("id", "tenantId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DriverIncident"
  ADD CONSTRAINT "DriverIncident_vehicle_tenant_fkey"
  FOREIGN KEY ("vehicleId", "tenantId") REFERENCES "Vehicle"("id", "tenantId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row Level Security
ALTER TABLE "DriverIncident" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DriverIncident" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_driverincident ON "DriverIncident"
  USING ("tenantId" = app_current_tenant_id())
  WITH CHECK ("tenantId" = app_current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON "DriverIncident" TO uyushma_app;

