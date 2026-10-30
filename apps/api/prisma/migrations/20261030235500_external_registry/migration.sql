-- ============================================================================
-- External registry integration: e-tender.uztrans.uz and bm.dtransport.uz.
-- Access tokens are ciphertext (AES-256-GCM, v1 envelope) and never leave the
-- tenant context. All tables are tenant-owned and protected by RLS.
-- ============================================================================

CREATE TYPE "ExternalProvider" AS ENUM ('ETENDER', 'AUTOPARK');
CREATE TYPE "ExternalConnectionStatus" AS ENUM ('ACTIVE', 'INVALID', 'DISABLED');
CREATE TYPE "ExternalSyncStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED');
CREATE TYPE "ExternalRecordKind" AS ENUM (
  'CONTRACT_APPLICATION',
  'CONTRACT',
  'CERTIFICATE',
  'TENDER_APPLICATION'
);

CREATE TABLE "ExternalConnection" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "provider" "ExternalProvider" NOT NULL,
  "baseUrl" VARCHAR(200) NOT NULL,
  "tokenEncrypted" TEXT NOT NULL,
  "config" JSONB,
  "status" "ExternalConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
  "lastSyncAt" TIMESTAMP(3),
  "lastError" VARCHAR(500),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ExternalConnection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExternalSyncRun" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "connectionId" UUID NOT NULL,
  "provider" "ExternalProvider" NOT NULL,
  "status" "ExternalSyncStatus" NOT NULL,
  "counts" JSONB,
  "error" VARCHAR(1000),
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),

  CONSTRAINT "ExternalSyncRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExternalVehicle" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "provider" "ExternalProvider" NOT NULL,
  "externalId" VARCHAR(120) NOT NULL,
  "plateNumber" VARCHAR(40),
  "garageNumber" VARCHAR(40),
  "vin" VARCHAR(40),
  "gpsImei" VARCHAR(40),
  "organizationName" VARCHAR(300),
  "routeName" VARCHAR(300),
  "routeNumber" VARCHAR(80),
  "vehicleClass" VARCHAR(160),
  "vehicleModel" VARCHAR(160),
  "drivers" JSONB,
  "licenseNumber" VARCHAR(80),
  "licenseExpiresAt" TIMESTAMP(3),
  "vehicleId" UUID,
  "raw" JSONB NOT NULL,
  "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ExternalVehicle_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExternalRecord" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "provider" "ExternalProvider" NOT NULL,
  "kind" "ExternalRecordKind" NOT NULL,
  "externalId" VARCHAR(120) NOT NULL,
  "number" VARCHAR(120),
  "title" VARCHAR(300),
  "status" VARCHAR(80),
  "startsAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "issuedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "raw" JSONB NOT NULL,
  "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ExternalRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExternalConnection_tenantId_provider_key"
  ON "ExternalConnection"("tenantId", "provider");
CREATE UNIQUE INDEX "ExternalConnection_id_tenantId_key"
  ON "ExternalConnection"("id", "tenantId");
CREATE INDEX "ExternalConnection_tenantId_status_idx"
  ON "ExternalConnection"("tenantId", "status");

CREATE UNIQUE INDEX "ExternalSyncRun_id_tenantId_key"
  ON "ExternalSyncRun"("id", "tenantId");
CREATE INDEX "ExternalSyncRun_tenantId_startedAt_idx"
  ON "ExternalSyncRun"("tenantId", "startedAt");
CREATE INDEX "ExternalSyncRun_connectionId_startedAt_idx"
  ON "ExternalSyncRun"("connectionId", "startedAt");

CREATE UNIQUE INDEX "ExternalVehicle_tenantId_provider_externalId_key"
  ON "ExternalVehicle"("tenantId", "provider", "externalId");
CREATE UNIQUE INDEX "ExternalVehicle_id_tenantId_key"
  ON "ExternalVehicle"("id", "tenantId");
CREATE INDEX "ExternalVehicle_tenantId_provider_plateNumber_idx"
  ON "ExternalVehicle"("tenantId", "provider", "plateNumber");
CREATE INDEX "ExternalVehicle_tenantId_vehicleId_idx"
  ON "ExternalVehicle"("tenantId", "vehicleId");

CREATE UNIQUE INDEX "ExternalRecord_tenantId_provider_kind_externalId_key"
  ON "ExternalRecord"("tenantId", "provider", "kind", "externalId");
CREATE UNIQUE INDEX "ExternalRecord_id_tenantId_key"
  ON "ExternalRecord"("id", "tenantId");
CREATE INDEX "ExternalRecord_tenantId_provider_kind_idx"
  ON "ExternalRecord"("tenantId", "provider", "kind");

ALTER TABLE "ExternalConnection"
  ADD CONSTRAINT "ExternalConnection_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Company"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ExternalSyncRun"
  ADD CONSTRAINT "ExternalSyncRun_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Company"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ExternalSyncRun"
  ADD CONSTRAINT "ExternalSyncRun_connectionId_fkey"
  FOREIGN KEY ("connectionId") REFERENCES "ExternalConnection"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ExternalVehicle"
  ADD CONSTRAINT "ExternalVehicle_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Company"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ExternalVehicle"
  ADD CONSTRAINT "ExternalVehicle_vehicleId_fkey"
  FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ExternalRecord"
  ADD CONSTRAINT "ExternalRecord_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Company"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Same-tenant guarantees for the run -> connection relation.
ALTER TABLE "ExternalSyncRun"
  ADD CONSTRAINT "ExternalSyncRun_connection_tenant_fkey"
  FOREIGN KEY ("connectionId", "tenantId")
  REFERENCES "ExternalConnection"("id", "tenantId")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'ExternalConnection', 'ExternalSyncRun', 'ExternalVehicle', 'ExternalRecord'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation_%s ON %I USING ("tenantId" = app_current_tenant_id()) WITH CHECK ("tenantId" = app_current_tenant_id())',
      lower(t), t
    );
  END LOOP;
END
$$;

-- The runtime role never deletes rows; disable is an UPDATE.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'uyushma_app') THEN
    GRANT SELECT, INSERT, UPDATE ON
      "ExternalConnection", "ExternalSyncRun", "ExternalVehicle", "ExternalRecord"
    TO uyushma_app;
  END IF;
END
$$;
