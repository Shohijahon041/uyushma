-- ============================================================================
-- Tenant isolation and database hardening.
-- This migration is additive. It never deletes tenant data.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Composite foreign keys: a row may only reference a parent row that
--    belongs to the same tenant. Prisma's single-column FKs stay in place for
--    client relations; these constraints close the cross-tenant hole.
-- ---------------------------------------------------------------------------
ALTER TABLE "RefreshToken"
  ADD CONSTRAINT "RefreshToken_user_tenant_fkey"
  FOREIGN KEY ("userId", "tenantId") REFERENCES "User"("id", "tenantId")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Vehicle"
  ADD CONSTRAINT "Vehicle_owner_tenant_fkey"
  FOREIGN KEY ("ownerId", "tenantId") REFERENCES "User"("id", "tenantId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Tariff"
  ADD CONSTRAINT "Tariff_route_tenant_fkey"
  FOREIGN KEY ("routeId", "tenantId") REFERENCES "Route"("id", "tenantId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Tariff"
  ADD CONSTRAINT "Tariff_creator_tenant_fkey"
  FOREIGN KEY ("createdById", "tenantId") REFERENCES "User"("id", "tenantId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TariffRule"
  ADD CONSTRAINT "TariffRule_tariff_tenant_fkey"
  FOREIGN KEY ("tariffId", "tenantId") REFERENCES "Tariff"("id", "tenantId")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Contract"
  ADD CONSTRAINT "Contract_vehicle_tenant_fkey"
  FOREIGN KEY ("vehicleId", "tenantId") REFERENCES "Vehicle"("id", "tenantId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Contract"
  ADD CONSTRAINT "Contract_owner_tenant_fkey"
  FOREIGN KEY ("ownerId", "tenantId") REFERENCES "User"("id", "tenantId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Contract"
  ADD CONSTRAINT "Contract_tariff_tenant_fkey"
  FOREIGN KEY ("tariffId", "tenantId") REFERENCES "Tariff"("id", "tenantId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Contract"
  ADD CONSTRAINT "Contract_creator_tenant_fkey"
  FOREIGN KEY ("createdById", "tenantId") REFERENCES "User"("id", "tenantId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_contract_tenant_fkey"
  FOREIGN KEY ("contractId", "tenantId") REFERENCES "Contract"("id", "tenantId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_creator_tenant_fkey"
  FOREIGN KEY ("createdById", "tenantId") REFERENCES "User"("id", "tenantId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PaymentWebhookEvent"
  ADD CONSTRAINT "PaymentWebhookEvent_payment_tenant_fkey"
  FOREIGN KEY ("paymentId", "tenantId") REFERENCES "Payment"("id", "tenantId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SubscriptionInvoice"
  ADD CONSTRAINT "SubscriptionInvoice_subscription_tenant_fkey"
  FOREIGN KEY ("subscriptionId", "tenantId") REFERENCES "Subscription"("id", "tenantId")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AuditLog"
  ADD CONSTRAINT "AuditLog_actor_tenant_fkey"
  FOREIGN KEY ("actorUserId", "tenantId") REFERENCES "User"("id", "tenantId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Document"
  ADD CONSTRAINT "Document_contract_tenant_fkey"
  FOREIGN KEY ("contractId", "tenantId") REFERENCES "Contract"("id", "tenantId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Document"
  ADD CONSTRAINT "Document_uploader_tenant_fkey"
  FOREIGN KEY ("uploadedById", "tenantId") REFERENCES "User"("id", "tenantId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TelegramLinkToken"
  ADD CONSTRAINT "TelegramLinkToken_user_tenant_fkey"
  FOREIGN KEY ("userId", "tenantId") REFERENCES "User"("id", "tenantId")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TelegramAccount"
  ADD CONSTRAINT "TelegramAccount_user_tenant_fkey"
  FOREIGN KEY ("userId", "tenantId") REFERENCES "User"("id", "tenantId")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- One live subscription per tenant.
CREATE UNIQUE INDEX "Subscription_one_live_per_tenant"
  ON "Subscription" ("tenantId")
  WHERE "status" IN ('TRIAL', 'ACTIVE', 'PAST_DUE');

-- ---------------------------------------------------------------------------
-- 2. Tenant context helper. Unset/empty context yields NULL, so a query made
--    without an explicit tenant sees zero tenant rows.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid;
$$;

-- ---------------------------------------------------------------------------
-- 3. Row Level Security: enabled AND forced on every tenant-owned table.
--    FORCE matters when the connecting role happens to own a table.
-- ---------------------------------------------------------------------------
ALTER TABLE "Company" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Company" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_company ON "Company"
  USING ("id" = app_current_tenant_id())
  WITH CHECK ("id" = app_current_tenant_id());

DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'User', 'RefreshToken', 'Route', 'Vehicle', 'Tariff', 'TariffRule',
    'Contract', 'Payment', 'PaymentWebhookEvent', 'Subscription',
    'SubscriptionInvoice', 'AuditLog', 'Document', 'TelegramLinkToken',
    'TelegramAccount'
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

-- Audit log is append-only: reads and inserts within the tenant only.
DROP POLICY tenant_isolation_auditlog ON "AuditLog";
CREATE POLICY audit_select_tenant ON "AuditLog"
  FOR SELECT USING ("tenantId" = app_current_tenant_id());
CREATE POLICY audit_insert_tenant ON "AuditLog"
  FOR INSERT WITH CHECK ("tenantId" = app_current_tenant_id());

CREATE OR REPLACE FUNCTION app_audit_log_is_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog is append-only';
END;
$$;

CREATE TRIGGER audit_log_immutable
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION app_audit_log_is_immutable();

-- ---------------------------------------------------------------------------
-- 4. Controlled pre-authentication lookups.
--    These SECURITY DEFINER functions expose the minimum needed to resolve a
--    tenant before a tenant context exists. They must never return business
--    data, and EXECUTE is revoked from PUBLIC.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_resolve_tenant_by_slug(p_slug text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id FROM "Company"
  WHERE slug = lower(p_slug) AND status = 'ACTIVE'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION app_resolve_telegram_chat(p_chat_id bigint)
RETURNS TABLE (tenant_id uuid, user_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT ta."tenantId", ta."userId"
  FROM "TelegramAccount" ta
  JOIN "Company" c ON c.id = ta."tenantId" AND c.status = 'ACTIVE'
  JOIN "User" u ON u.id = ta."userId" AND u."isActive" = true
  WHERE ta."chatId" = p_chat_id
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION app_consume_telegram_link_token(
  p_token_hash text,
  p_chat_id bigint,
  p_username text DEFAULT NULL
)
RETURNS TABLE (tenant_id uuid, user_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid;
  v_user uuid;
BEGIN
  UPDATE "TelegramLinkToken"
  SET "usedAt" = now()
  WHERE "tokenHash" = p_token_hash
    AND "usedAt" IS NULL
    AND "expiresAt" > now()
  RETURNING "tenantId", "userId" INTO v_tenant, v_user;

  IF v_tenant IS NULL THEN
    RETURN;
  END IF;

  -- A Telegram chat has exactly one active link. Relinking is explicit via a
  -- freshly generated, single-use token.
  DELETE FROM "TelegramAccount" WHERE "chatId" = p_chat_id;
  DELETE FROM "TelegramAccount"
  WHERE "tenantId" = v_tenant AND "userId" = v_user;

  INSERT INTO "TelegramAccount" (id, "tenantId", "userId", "chatId", username, "linkedAt")
  VALUES (gen_random_uuid(), v_tenant, v_user, p_chat_id, p_username, now());

  RETURN QUERY SELECT v_tenant, v_user;
END;
$$;

-- Used by the internal billing job; exposes tenant identifiers only.
CREATE OR REPLACE FUNCTION app_list_active_tenant_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id FROM "Company" WHERE status = 'ACTIVE';
$$;

REVOKE ALL ON FUNCTION app_resolve_tenant_by_slug(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_resolve_telegram_chat(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_consume_telegram_link_token(text, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_list_active_tenant_ids() FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 5. Privileges for the limited application role. The role must exist and must
--    NOT be superuser/bypassrls. Production ops creates it out of band.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'uyushma_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO uyushma_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO uyushma_app;

    REVOKE INSERT, UPDATE, DELETE ON "Plan" FROM uyushma_app;
    GRANT SELECT ON "Plan" TO uyushma_app;

    REVOKE UPDATE, DELETE ON "AuditLog" FROM uyushma_app;

    -- Financial and legal history is never deleted by the application role.
    REVOKE DELETE ON "Payment", "PaymentWebhookEvent", "Contract", "Subscription",
      "SubscriptionInvoice", "Document" FROM uyushma_app;

    GRANT EXECUTE ON FUNCTION app_current_tenant_id() TO uyushma_app;
    GRANT EXECUTE ON FUNCTION app_resolve_tenant_by_slug(text) TO uyushma_app;
    GRANT EXECUTE ON FUNCTION app_resolve_telegram_chat(bigint) TO uyushma_app;
    GRANT EXECUTE ON FUNCTION app_consume_telegram_link_token(text, bigint, text) TO uyushma_app;
    GRANT EXECUTE ON FUNCTION app_list_active_tenant_ids() TO uyushma_app;

    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO uyushma_app;
  END IF;
END
$$;
