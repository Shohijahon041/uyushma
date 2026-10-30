-- Validate the link token before touching any existing chat link, so an
-- invalid or replayed code can never unlink an already connected account.
CREATE OR REPLACE FUNCTION app_consume_driver_link_token(
  p_token_hash text,
  p_chat_id bigint,
  p_username text DEFAULT NULL
)
RETURNS TABLE (tenant_id uuid, driver_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid;
  v_driver uuid;
BEGIN
  SELECT d."tenantId", d.id INTO v_tenant, v_driver
  FROM "Driver" d
  JOIN "Company" c ON c.id = d."tenantId" AND c.status = 'ACTIVE'
  WHERE d."telegramLinkTokenHash" = p_token_hash
    AND d."telegramLinkExpiresAt" > now()
    AND d.status = 'ACTIVE'
  FOR UPDATE OF d;

  IF v_driver IS NULL THEN
    RETURN;
  END IF;

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
      "telegramLinkedAt" = now(),
      "telegramLinkTokenHash" = NULL,
      "telegramLinkExpiresAt" = NULL,
      "updatedAt" = now()
  WHERE id = v_driver;

  RETURN QUERY SELECT v_tenant, v_driver;
END;
$$;

REVOKE ALL ON FUNCTION app_consume_driver_link_token(text, bigint, text) FROM PUBLIC;

-- A chat is either a staff account or a driver, never both.
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

  DELETE FROM "TelegramAccount" WHERE "chatId" = p_chat_id;
  DELETE FROM "TelegramAccount"
  WHERE "tenantId" = v_tenant AND "userId" = v_user;

  UPDATE "Driver"
  SET "telegramChatId" = NULL,
      "telegramUsername" = NULL,
      "telegramLinkedAt" = NULL,
      "updatedAt" = now()
  WHERE "telegramChatId" = p_chat_id;

  INSERT INTO "TelegramAccount" (id, "tenantId", "userId", "chatId", username, "linkedAt")
  VALUES (gen_random_uuid(), v_tenant, v_user, p_chat_id, p_username, now());

  RETURN QUERY SELECT v_tenant, v_user;
END;
$$;

REVOKE ALL ON FUNCTION app_consume_telegram_link_token(text, bigint, text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'uyushma_app') THEN
    GRANT EXECUTE ON FUNCTION app_consume_driver_link_token(text, bigint, text) TO uyushma_app;
    GRANT EXECUTE ON FUNCTION app_consume_telegram_link_token(text, bigint, text) TO uyushma_app;
  END IF;
END
$$;
