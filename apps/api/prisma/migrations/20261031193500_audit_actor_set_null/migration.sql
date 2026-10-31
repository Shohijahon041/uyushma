-- Update AuditLog actor relation to SET NULL on user delete and allow company cleanup in trigger
ALTER TABLE "AuditLog" DROP CONSTRAINT IF EXISTS "AuditLog_actorUserId_fkey";
ALTER TABLE "AuditLog" DROP CONSTRAINT IF EXISTS "AuditLog_actor_tenant_fkey";

ALTER TABLE "AuditLog"
  ADD CONSTRAINT "AuditLog_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DROP POLICY IF EXISTS audit_delete_tenant ON "AuditLog";
DROP POLICY IF EXISTS audit_update_tenant ON "AuditLog";

CREATE POLICY audit_delete_tenant ON "AuditLog"
  FOR DELETE USING ("tenantId" = app_current_tenant_id());
CREATE POLICY audit_update_tenant ON "AuditLog"
  FOR UPDATE USING ("tenantId" = app_current_tenant_id());

CREATE OR REPLACE FUNCTION app_audit_log_is_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('app.allow_audit_delete', true) = 'on' THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."actorUserId" IS NULL THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'AuditLog is append-only';
END;
$$;
