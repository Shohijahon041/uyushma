-- ============================================================================
-- Yo'l varaqalari (Putyovkalar) tizimi.
-- Tibbiy ko'rik, texnik ko'rik, yoqilg'i hisobi, spidometr nazorati va QR kod.
-- ============================================================================

CREATE TYPE "WaybillStatus" AS ENUM ('ISSUED', 'ACTIVE', 'COMPLETED', 'CANCELLED');

CREATE TABLE "Waybill" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "number" VARCHAR(50) NOT NULL,
  "status" "WaybillStatus" NOT NULL DEFAULT 'ISSUED',
  "date" DATE NOT NULL,
  "validUntil" TIMESTAMP(3),

  "driverId" UUID NOT NULL,
  "vehicleId" UUID NOT NULL,
  "routeId" UUID,

  -- Tibbiy ko'rik
  "medicalPassed" BOOLEAN NOT NULL DEFAULT true,
  "medicalDoctorName" VARCHAR(160),
  "medicalCheckedAt" TIMESTAMP(3),
  "medicalNotes" VARCHAR(300),

  -- Texnik ko'rik
  "technicalPassed" BOOLEAN NOT NULL DEFAULT true,
  "mechanicName" VARCHAR(160),
  "technicalCheckedAt" TIMESTAMP(3),
  "technicalNotes" VARCHAR(300),

  -- Harakat va spidometr
  "startOdometer" INTEGER,
  "endOdometer" INTEGER,
  "distanceKm" INTEGER,
  "departureTime" TIMESTAMP(3),
  "returnTime" TIMESTAMP(3),

  -- Yoqilg'i
  "fuelType" VARCHAR(50),
  "fuelBefore" DECIMAL(10, 2),
  "fuelGiven" DECIMAL(10, 2),
  "fuelAfter" DECIMAL(10, 2),

  -- Mas'ul shaxslar va qo'shimcha
  "dispatcherName" VARCHAR(160),
  "specialNotes" VARCHAR(500),
  "publicToken" VARCHAR(64) NOT NULL,

  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Waybill_pkey" PRIMARY KEY ("id")
);

-- Indekslar va unikal cheklovlar
CREATE UNIQUE INDEX "Waybill_id_tenantId_key" ON "Waybill"("id", "tenantId");
CREATE UNIQUE INDEX "Waybill_tenantId_number_key" ON "Waybill"("tenantId", "number");
CREATE UNIQUE INDEX "Waybill_publicToken_key" ON "Waybill"("publicToken");

CREATE INDEX "Waybill_tenantId_status_date_idx" ON "Waybill"("tenantId", "status", "date");
CREATE INDEX "Waybill_tenantId_driverId_date_idx" ON "Waybill"("tenantId", "driverId", "date");
CREATE INDEX "Waybill_tenantId_vehicleId_date_idx" ON "Waybill"("tenantId", "vehicleId", "date");
CREATE INDEX "Waybill_publicToken_idx" ON "Waybill"("publicToken");

-- Tashqi kalitlar (Foreign Keys)
ALTER TABLE "Waybill" ADD CONSTRAINT "Waybill_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Waybill" ADD CONSTRAINT "Waybill_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Waybill" ADD CONSTRAINT "Waybill_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Waybill" ADD CONSTRAINT "Waybill_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Cross-tenant izolyatsiyasi
ALTER TABLE "Waybill"
  ADD CONSTRAINT "Waybill_driver_tenant_fkey"
  FOREIGN KEY ("driverId", "tenantId") REFERENCES "Driver"("id", "tenantId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Waybill"
  ADD CONSTRAINT "Waybill_vehicle_tenant_fkey"
  FOREIGN KEY ("vehicleId", "tenantId") REFERENCES "Vehicle"("id", "tenantId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row Level Security
ALTER TABLE "Waybill" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Waybill" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_waybill ON "Waybill"
  USING ("tenantId" = app_current_tenant_id())
  WITH CHECK ("tenantId" = app_current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON "Waybill" TO uyushma_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "Waybill" TO postgres;

-- ---------------------------------------------------------------------------
-- Onlayn tekshiruv (QR-kod skanerlaganda ochiq tekshiruv funksiyasi)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_get_public_waybill(p_token VARCHAR)
RETURNS TABLE (
  "id" UUID,
  "number" VARCHAR,
  "status" "WaybillStatus",
  "date" DATE,
  "validUntil" TIMESTAMP(3),
  "companyName" VARCHAR,
  "driverName" VARCHAR,
  "driverPhone" VARCHAR,
  "licenseNumber" VARCHAR,
  "plateNumber" VARCHAR,
  "vehicleModel" VARCHAR,
  "routeName" VARCHAR,
  "routeNumber" VARCHAR,
  "medicalPassed" BOOLEAN,
  "medicalDoctorName" VARCHAR,
  "medicalCheckedAt" TIMESTAMP(3),
  "medicalNotes" VARCHAR,
  "technicalPassed" BOOLEAN,
  "mechanicName" VARCHAR,
  "technicalCheckedAt" TIMESTAMP(3),
  "technicalNotes" VARCHAR,
  "startOdometer" INTEGER,
  "endOdometer" INTEGER,
  "distanceKm" INTEGER,
  "departureTime" TIMESTAMP(3),
  "returnTime" TIMESTAMP(3),
  "fuelType" VARCHAR,
  "fuelBefore" DECIMAL,
  "fuelGiven" DECIMAL,
  "fuelAfter" DECIMAL,
  "dispatcherName" VARCHAR,
  "specialNotes" VARCHAR
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    w."id",
    w."number",
    w."status",
    w."date",
    w."validUntil",
    c."name"::VARCHAR AS "companyName",
    d."fullName"::VARCHAR AS "driverName",
    d."phone"::VARCHAR AS "driverPhone",
    d."licenseNumber"::VARCHAR AS "licenseNumber",
    v."plateNumber"::VARCHAR AS "plateNumber",
    v."model"::VARCHAR AS "vehicleModel",
    r."name"::VARCHAR AS "routeName",
    ev."routeNumber"::VARCHAR AS "routeNumber",
    w."medicalPassed",
    w."medicalDoctorName",
    w."medicalCheckedAt",
    w."medicalNotes",
    w."technicalPassed",
    w."mechanicName",
    w."technicalCheckedAt",
    w."technicalNotes",
    w."startOdometer",
    w."endOdometer",
    w."distanceKm",
    w."departureTime",
    w."returnTime",
    w."fuelType",
    w."fuelBefore",
    w."fuelGiven",
    w."fuelAfter",
    w."dispatcherName",
    w."specialNotes"
  FROM "Waybill" w
  JOIN "Company" c ON c."id" = w."tenantId"
  JOIN "Driver" d ON d."id" = w."driverId" AND d."tenantId" = w."tenantId"
  JOIN "Vehicle" v ON v."id" = w."vehicleId" AND v."tenantId" = w."tenantId"
  LEFT JOIN "Route" r ON r."id" = w."routeId" AND r."tenantId" = w."tenantId"
  LEFT JOIN "ExternalVehicle" ev ON ev."vehicleId" = v."id" AND ev."tenantId" = w."tenantId"
  WHERE w."publicToken" = p_token
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION app_get_public_waybill(VARCHAR) TO uyushma_app, PUBLIC;
