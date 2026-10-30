CREATE UNIQUE INDEX "Contract_one_active_per_vehicle"
  ON "Contract" ("tenantId", "vehicleId")
  WHERE "status" = 'ACTIVE';
