-- Seguimientos por etapa: ~4 h (first), ~23 h (final) y reactivación a los ~6 meses (reactivation).
-- Antes había un solo seguimiento por paciente (índice único clinic_id + phone); las filas existentes
-- quedan como "final". Idempotente. Ejecutar después de 20260926_create_follow_ups.sql.
-- Si aún no se ejecuta, el bot sigue funcionando: solo envía el seguimiento de ~23 h.
ALTER TABLE IF EXISTS public.follow_ups ADD COLUMN IF NOT EXISTS stage TEXT NOT NULL DEFAULT 'final';

DO $$
BEGIN
  IF to_regclass('public.follow_ups') IS NOT NULL THEN
    DROP INDEX IF EXISTS public.follow_ups_clinic_phone_uidx;
    CREATE UNIQUE INDEX IF NOT EXISTS follow_ups_clinic_phone_stage_uidx ON public.follow_ups (clinic_id, phone, stage);
    -- Reactivación: busca citas por fecha.
    IF to_regclass('public.appointments') IS NOT NULL THEN
      CREATE INDEX IF NOT EXISTS appointments_clinic_date_idx ON public.appointments (clinic_id, appointment_date);
    END IF;
  END IF;
END $$;
