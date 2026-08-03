-- Migration: add notified_at, unique constraint/index on telefono, index on notified_at, and create prospects table

-- Add notified_at column to leads
ALTER TABLE IF EXISTS leads
  ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ NULL;

-- Ensure telefono is indexed uniquely for safe UPSERT operations
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_telefono_unique ON leads (telefono);

-- Index to speed up queries filtering by notified_at
CREATE INDEX IF NOT EXISTS idx_leads_notified_at ON leads (notified_at);

-- Create prospects table if not exists
CREATE TABLE IF NOT EXISTS prospects (
  id BIGSERIAL PRIMARY KEY,
  page_name TEXT NOT NULL,
  page_id TEXT UNIQUE,
  telefono TEXT,
  ad_snapshot_url TEXT,
  plataformas TEXT[],
  estado TEXT DEFAULT 'nuevo',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index on page_id for quick lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_prospects_page_id ON prospects (page_id);
CREATE INDEX IF NOT EXISTS idx_prospects_estado ON prospects (estado);

-- End of migration
