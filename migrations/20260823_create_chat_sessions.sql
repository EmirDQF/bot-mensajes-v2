-- Migration: create chat_sessions table for session persistence
-- Generated: 2026-08-23

CREATE TABLE IF NOT EXISTS public.chat_sessions (
  id TEXT PRIMARY KEY,
  history JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

-- Optional index to help cleanup queries by expiration
CREATE INDEX IF NOT EXISTS idx_chat_sessions_expires_at ON public.chat_sessions (expires_at);
