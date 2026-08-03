-- Migration: add chatwoot fields to clinics
-- Adds chatwoot_account_id, chatwoot_inbox_id, chatwoot_api_token to clinics table

BEGIN;

ALTER TABLE IF EXISTS clinics
  ADD COLUMN IF NOT EXISTS chatwoot_account_id text NULL;

ALTER TABLE IF EXISTS clinics
  ADD COLUMN IF NOT EXISTS chatwoot_inbox_id text NULL;

ALTER TABLE IF EXISTS clinics
  ADD COLUMN IF NOT EXISTS chatwoot_api_token text NULL;

-- Indexes to speed lookup by inbox/account id
CREATE INDEX IF NOT EXISTS idx_clinics_chatwoot_inbox_id ON clinics(chatwoot_inbox_id);
CREATE INDEX IF NOT EXISTS idx_clinics_chatwoot_account_id ON clinics(chatwoot_account_id);

COMMIT;