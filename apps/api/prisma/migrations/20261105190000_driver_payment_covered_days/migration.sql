-- To'lov qaysi kunlarni qoplashini saqlash: haydovchi bugun yoki ertangi kun
-- uchun to'lasa, o'sha kunlarda "ishga chiqqan" hisoblanadi.
ALTER TABLE "DriverPayment"
  ADD COLUMN "days" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "coveredFrom" DATE,
  ADD COLUMN "coveredUntil" DATE;

-- Mavjud to'lovlar uchun qoplanish davri to'lov qilingan kunning o'zi.
UPDATE "DriverPayment"
SET "coveredFrom" = (("paidAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tashkent')::date,
    "coveredUntil" = (("paidAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tashkent')::date
WHERE "coveredFrom" IS NULL;

ALTER TABLE "DriverPayment" ALTER COLUMN "coveredFrom" SET NOT NULL;
ALTER TABLE "DriverPayment" ALTER COLUMN "coveredUntil" SET NOT NULL;

CREATE INDEX "DriverPayment_tenantId_coveredFrom_coveredUntil_idx"
  ON "DriverPayment"("tenantId", "coveredFrom", "coveredUntil");
