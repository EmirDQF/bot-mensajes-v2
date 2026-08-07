-- Migration: add lead_snapshot JSONB column to leads table
-- Generated: 2026-08-06

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS lead_snapshot JSONB;
