-- Ficha del paciente en la bandeja y lead score. Idempotente.
-- tags: en_tratamiento, vip, precio_sensible, no_contactar ("no contactar" bloquea los seguimientos).
-- notes: notas internas de recepción · bot_notes: notas "para el bot" (entran a Gemini saneadas y delimitadas).

ALTER TABLE IF EXISTS public.leads ADD COLUMN IF NOT EXISTS treatment_interest TEXT;
ALTER TABLE IF EXISTS public.leads ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE IF EXISTS public.leads ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE IF EXISTS public.leads ADD COLUMN IF NOT EXISTS bot_notes TEXT;
ALTER TABLE IF EXISTS public.leads ADD COLUMN IF NOT EXISTS lead_score TEXT;
ALTER TABLE IF EXISTS public.leads ADD COLUMN IF NOT EXISTS lead_score_reason TEXT;
ALTER TABLE IF EXISTS public.leads ADD COLUMN IF NOT EXISTS lead_score_at TIMESTAMPTZ;

DO $$
BEGIN
  IF to_regclass('public.leads') IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_lead_score_check') THEN
    ALTER TABLE public.leads ADD CONSTRAINT leads_lead_score_check CHECK (lead_score IS NULL OR lead_score IN ('caliente', 'tibio', 'frio'));
  END IF;
END $$;
