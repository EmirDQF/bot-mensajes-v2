-- Respuesta del paciente al recordatorio ("Confirmo" / "Reprogramar"): estado del recordatorio en la ficha
-- del doctor y en las métricas. Idempotente. Ejecutar después de 20260925_create_appointments.sql.
-- Sin esta migración el bot sigue funcionando: la respuesta se procesa igual, solo no queda guardada.
ALTER TABLE IF EXISTS public.appointments ADD COLUMN IF NOT EXISTS reminder_reply TEXT;
ALTER TABLE IF EXISTS public.appointments ADD COLUMN IF NOT EXISTS reminder_reply_at TIMESTAMPTZ;
