-- Function to resolve vehicle and tenant for public QR/inspection lookup across RLS boundaries
CREATE OR REPLACE FUNCTION app_resolve_vehicle_tenant(p_plate text)
RETURNS TABLE (tenant_id uuid, vehicle_id uuid, plate_number text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_norm text := upper(regexp_replace(p_plate, '[^A-Za-z0-9]', '', 'g'));
  v_rec record;
BEGIN
  IF v_norm IS NULL OR length(v_norm) = 0 THEN
    RETURN;
  END IF;

  -- 1. Avval asosiy Vehicle jadvalidan qidirish
  SELECT v."tenantId", v.id, v."plateNumber"::text AS plate_num INTO v_rec
  FROM "Vehicle" v
  JOIN "Company" c ON c.id = v."tenantId" AND c.status = 'ACTIVE'
  WHERE upper(regexp_replace(v."plateNumber", '[^A-Za-z0-9]', '', 'g')) = v_norm
     OR upper(trim(v."plateNumber")) = upper(trim(p_plate))
  LIMIT 1;

  IF v_rec."tenantId" IS NOT NULL THEN
    RETURN QUERY SELECT v_rec."tenantId", v_rec.id, v_rec.plate_num::text;
    RETURN;
  END IF;

  -- 2. Agar asosiyda topilmasa, ExternalVehicle dan qidirish
  SELECT ev."tenantId", ev."vehicleId", ev."plateNumber"::text AS plate_num INTO v_rec
  FROM "ExternalVehicle" ev
  JOIN "Company" c ON c.id = ev."tenantId" AND c.status = 'ACTIVE'
  WHERE upper(regexp_replace(ev."plateNumber", '[^A-Za-z0-9]', '', 'g')) = v_norm
     OR upper(trim(ev."plateNumber")) = upper(trim(p_plate))
  LIMIT 1;

  IF v_rec."tenantId" IS NOT NULL THEN
    RETURN QUERY SELECT v_rec."tenantId", v_rec."vehicleId", v_rec.plate_num::text;
    RETURN;
  END IF;

  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION app_resolve_vehicle_tenant(text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'uyushma_app') THEN
    GRANT EXECUTE ON FUNCTION app_resolve_vehicle_tenant(text) TO uyushma_app;
  END IF;
END $$;
