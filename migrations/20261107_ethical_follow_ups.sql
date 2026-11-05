-- Seguimiento ético (3 h, ~22 h y día 3) con opt-out y opt-in registrados. Idempotente.
-- Ejecutar después de 20261104_follow_up_stages.sql.
-- Sin esta migración el bot sigue funcionando: el seguimiento corre con una etapa por paciente y el opt-out se
-- guarda como la etiqueta "no_contactar" de la ficha del lead.

-- Preferencias de contacto por paciente: opt-out de seguimientos (con fecha y motivo), opt-in de marketing con
-- fecha y origen (requisito para la plantilla del día 3 y las promociones) y marca de menor de edad.
CREATE TABLE IF NOT EXISTS public.contact_preferences (
  clinic_id TEXT NOT NULL,
  phone TEXT NOT NULL,
  followups_opt_out_at TIMESTAMPTZ,
  opt_out_reason TEXT,
  marketing_opt_in_at TIMESTAMPTZ,
  marketing_opt_in_source TEXT,
  marketing_opt_out_at TIMESTAMPTZ,
  minor_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (clinic_id, phone)
);
ALTER TABLE public.contact_preferences ENABLE ROW LEVEL SECURITY;

-- Cada etapa del seguimiento se ancla al último mensaje del paciente (anchor_at): si vuelve a escribir y otra vez
-- se queda callado, puede recibir la etapa de nuevo, pero nunca más de 3 seguimientos en 30 días (lo controla el bot).
ALTER TABLE IF EXISTS public.follow_ups ADD COLUMN IF NOT EXISTS anchor_at TIMESTAMPTZ;
DO $$
BEGIN
  IF to_regclass('public.follow_ups') IS NOT NULL THEN
    DROP INDEX IF EXISTS public.follow_ups_clinic_phone_stage_uidx;
    CREATE UNIQUE INDEX IF NOT EXISTS follow_ups_clinic_phone_stage_anchor_uidx
      ON public.follow_ups (clinic_id, phone, stage, COALESCE(anchor_at, 'epoch'::timestamptz));
    CREATE INDEX IF NOT EXISTS follow_ups_clinic_phone_sent_idx ON public.follow_ups (clinic_id, phone, sent_at DESC);
  END IF;
END $$;
