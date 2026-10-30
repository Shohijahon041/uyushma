-- Yo'nalish oylik plani va avtomobilni yo'nalishga bog'lash.
ALTER TABLE "Route" ADD COLUMN "monthlyPlan" DECIMAL(18,2) NOT NULL DEFAULT 0;

ALTER TABLE "Vehicle" ADD COLUMN "routeId" UUID;
CREATE INDEX "Vehicle_tenantId_routeId_idx" ON "Vehicle"("tenantId", "routeId");
ALTER TABLE "Vehicle"
  ADD CONSTRAINT "Vehicle_routeId_tenantId_fkey"
  FOREIGN KEY ("routeId", "tenantId") REFERENCES "Route"("id", "tenantId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Haydovchi hujjatlari va Telegram profili.
ALTER TABLE "Driver"
  ADD COLUMN "telegramFirstName" VARCHAR(64),
  ADD COLUMN "telegramLastName" VARCHAR(64),
  ADD COLUMN "telegramPhotoFileId" VARCHAR(255),
  ADD COLUMN "passportNumber" VARCHAR(20),
  ADD COLUMN "passportIssuedBy" VARCHAR(160),
  ADD COLUMN "passportIssuedAt" DATE,
  ADD COLUMN "pinfl" VARCHAR(14),
  ADD COLUMN "birthDate" DATE,
  ADD COLUMN "passportPhotoFileId" VARCHAR(255),
  ADD COLUMN "licenseCategories" VARCHAR(40),
  ADD COLUMN "licenseIssuedAt" DATE,
  ADD COLUMN "licenseExpiresAt" DATE,
  ADD COLUMN "licensePhotoFileId" VARCHAR(255);

-- Mavjud avtomobillarni tashqi reyestrdagi yo'nalish nomi bo'yicha bog'lash.
UPDATE "Vehicle" v
SET "routeId" = r.id
FROM "ExternalVehicle" e
JOIN "Route" r ON r."tenantId" = e."tenantId" AND r.name = e."routeName"
WHERE e."vehicleId" = v.id
  AND e."tenantId" = v."tenantId"
  AND v."routeId" IS NULL;

-- Sig'im: e-tender `seats_tonnage` maydonidan to'ldirish.
UPDATE "Vehicle" v
SET capacity = LEAST(120, ROUND((e.raw->>'seats_tonnage')::numeric))::int
FROM "ExternalVehicle" e
WHERE e."vehicleId" = v.id
  AND e."tenantId" = v."tenantId"
  AND v.capacity = 0
  AND (e.raw->>'seats_tonnage') ~ '^\s*\d+(\.\d+)?\s*$'
  AND (e.raw->>'seats_tonnage')::numeric > 0;

-- Telefon raqami orqali haydovchini Telegramga bog'lash. Bot raqamni Telegram
-- kontakt tugmasi orqali (egasi tasdiqlagan holda) yuboradi.
CREATE OR REPLACE FUNCTION app_link_driver_by_phone(
  p_phone text,
  p_chat_id bigint,
  p_username text DEFAULT NULL,
  p_first_name text DEFAULT NULL,
  p_last_name text DEFAULT NULL
)
RETURNS TABLE (status text, tenant_id uuid, driver_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_tail text;
  v_count int;
  v_tenant uuid;
  v_driver uuid;
BEGIN
  IF length(v_digits) < 9 THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;
  v_tail := right(v_digits, 9);

  SELECT count(*) INTO v_count
  FROM "Driver" d
  JOIN "Company" c ON c.id = d."tenantId" AND c.status = 'ACTIVE'
  WHERE d.status = 'ACTIVE'
    AND right(regexp_replace(d.phone, '\D', '', 'g'), 9) = v_tail;

  IF v_count = 0 THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;
  IF v_count > 1 THEN
    RETURN QUERY SELECT 'ambiguous'::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  SELECT d."tenantId", d.id INTO v_tenant, v_driver
  FROM "Driver" d
  JOIN "Company" c ON c.id = d."tenantId" AND c.status = 'ACTIVE'
  WHERE d.status = 'ACTIVE'
    AND right(regexp_replace(d.phone, '\D', '', 'g'), 9) = v_tail
  FOR UPDATE OF d;

  UPDATE "Driver"
  SET "telegramChatId" = NULL,
      "telegramUsername" = NULL,
      "telegramLinkedAt" = NULL,
      "updatedAt" = now()
  WHERE "telegramChatId" = p_chat_id AND id <> v_driver;

  DELETE FROM "TelegramAccount" WHERE "chatId" = p_chat_id;

  UPDATE "Driver"
  SET "telegramChatId" = p_chat_id,
      "telegramUsername" = p_username,
      "telegramFirstName" = left(p_first_name, 64),
      "telegramLastName" = left(p_last_name, 64),
      "telegramLinkedAt" = now(),
      "telegramLinkTokenHash" = NULL,
      "telegramLinkExpiresAt" = NULL,
      "updatedAt" = now()
  WHERE id = v_driver;

  RETURN QUERY SELECT 'linked'::text, v_tenant, v_driver;
END;
$$;

REVOKE ALL ON FUNCTION app_link_driver_by_phone(text, bigint, text, text, text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'uyushma_app') THEN
    GRANT EXECUTE ON FUNCTION app_link_driver_by_phone(text, bigint, text, text, text) TO uyushma_app;
  END IF;
END
$$;
