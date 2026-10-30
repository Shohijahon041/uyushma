-- Automatic One ID / BM login: provider credentials (login + password) are
-- stored as an AES-256-GCM envelope, same as tokens. lastLoginAt records the
-- last successful credential exchange so the UI can show session freshness.

ALTER TABLE "ExternalConnection"
  ADD COLUMN "credentialsEncrypted" TEXT,
  ADD COLUMN "lastLoginAt" TIMESTAMP(3);
