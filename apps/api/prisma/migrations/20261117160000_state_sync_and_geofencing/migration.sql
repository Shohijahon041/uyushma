-- ============================================================================
-- Davlat portallari sinxronizatsiyasi, Geofencing va Marshrut koridorlari
-- ============================================================================

-- 1. Route jadvaliga koridor polyline va kenglik ustunlarini qo'shish
ALTER TABLE "Route"
  ADD COLUMN IF NOT EXISTS "corridorPolyline" JSONB,
  ADD COLUMN IF NOT EXISTS "corridorWidthMeters" INTEGER NOT NULL DEFAULT 150;

-- 2. Vehicle jadvaliga bloklash va istisno (override) ustunlarini qo'shish
ALTER TABLE "Vehicle"
  ADD COLUMN IF NOT EXISTS "isBlocked" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "blockReason" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "manualOverrideUntil" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "overrideReason" VARCHAR(255);

CREATE INDEX IF NOT EXISTS "Vehicle_tenantId_isBlocked_idx" ON "Vehicle"("tenantId", "isBlocked");

-- 3. RouteStop (Marshrut bekatlari) jadvali
CREATE TABLE IF NOT EXISTS "RouteStop" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "routeId" UUID NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "latitude" DOUBLE PRECISION NOT NULL,
  "longitude" DOUBLE PRECISION NOT NULL,
  "radiusMeters" INTEGER NOT NULL DEFAULT 100,
  "orderIndex" INTEGER NOT NULL DEFAULT 0,
  "isMandatory" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "RouteStop_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "RouteStop_id_tenantId_key" ON "RouteStop"("id", "tenantId");
CREATE INDEX IF NOT EXISTS "RouteStop_tenantId_routeId_orderIndex_idx" ON "RouteStop"("tenantId", "routeId", "orderIndex");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RouteStop_tenantId_fkey') THEN
    ALTER TABLE "RouteStop" ADD CONSTRAINT "RouteStop_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RouteStop_routeId_tenantId_fkey') THEN
    ALTER TABLE "RouteStop" ADD CONSTRAINT "RouteStop_routeId_tenantId_fkey" FOREIGN KEY ("routeId", "tenantId") REFERENCES "Route"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "RouteStop" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RouteStop" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'tenant_isolation_routestop' AND tablename = 'RouteStop') THEN
    CREATE POLICY tenant_isolation_routestop ON "RouteStop"
      USING ("tenantId" = app_current_tenant_id())
      WITH CHECK ("tenantId" = app_current_tenant_id());
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON "RouteStop" TO uyushma_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "RouteStop" TO postgres;

-- 4. Alert turlari va SystemAlert jadvali
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AlertSeverity') THEN
    CREATE TYPE "AlertSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AlertType') THEN
    CREATE TYPE "AlertType" AS ENUM ('STATE_SYNC_EXPIRY', 'ROUTE_DEVIATION', 'SPEED_EXCEEDED', 'SOS_PANIC', 'DEVICE_OFFLINE');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "SystemAlert" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "vehicleId" UUID,
  "driverId" UUID,
  "type" "AlertType" NOT NULL,
  "severity" "AlertSeverity" NOT NULL DEFAULT 'INFO',
  "title" VARCHAR(160) NOT NULL,
  "message" VARCHAR(500) NOT NULL,
  "metadata" JSONB,
  "isResolved" BOOLEAN NOT NULL DEFAULT false,
  "resolvedAt" TIMESTAMP(3),
  "resolvedBy" VARCHAR(160),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SystemAlert_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SystemAlert_id_tenantId_key" ON "SystemAlert"("id", "tenantId");
CREATE INDEX IF NOT EXISTS "SystemAlert_tenantId_isResolved_createdAt_idx" ON "SystemAlert"("tenantId", "isResolved", "createdAt");
CREATE INDEX IF NOT EXISTS "SystemAlert_tenantId_type_createdAt_idx" ON "SystemAlert"("tenantId", "type", "createdAt");
CREATE INDEX IF NOT EXISTS "SystemAlert_tenantId_vehicleId_idx" ON "SystemAlert"("tenantId", "vehicleId");
CREATE INDEX IF NOT EXISTS "SystemAlert_tenantId_driverId_idx" ON "SystemAlert"("tenantId", "driverId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SystemAlert_tenantId_fkey') THEN
    ALTER TABLE "SystemAlert" ADD CONSTRAINT "SystemAlert_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SystemAlert_vehicleId_fkey') THEN
    ALTER TABLE "SystemAlert" ADD CONSTRAINT "SystemAlert_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SystemAlert_driverId_fkey') THEN
    ALTER TABLE "SystemAlert" ADD CONSTRAINT "SystemAlert_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "SystemAlert" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SystemAlert" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'tenant_isolation_systemalert' AND tablename = 'SystemAlert') THEN
    CREATE POLICY tenant_isolation_systemalert ON "SystemAlert"
      USING ("tenantId" = app_current_tenant_id())
      WITH CHECK ("tenantId" = app_current_tenant_id());
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON "SystemAlert" TO uyushma_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "SystemAlert" TO postgres;

