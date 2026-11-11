-- Update app_get_public_waybill to also return vehicle owner details (ownerName, ownerPhone)
DROP FUNCTION IF EXISTS app_get_public_waybill(VARCHAR);

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
  "ownerName" VARCHAR,
  "ownerPhone" VARCHAR,
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
    u."fullName"::VARCHAR AS "ownerName",
    u."phone"::VARCHAR AS "ownerPhone",
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
  LEFT JOIN "User" u ON u."id" = v."ownerId"
  LEFT JOIN "Route" r ON r."id" = w."routeId" AND r."tenantId" = w."tenantId"
  LEFT JOIN "ExternalVehicle" ev ON ev."vehicleId" = v."id" AND ev."tenantId" = w."tenantId"
  WHERE w."publicToken" = p_token
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION app_get_public_waybill(VARCHAR) TO uyushma_app, PUBLIC;
