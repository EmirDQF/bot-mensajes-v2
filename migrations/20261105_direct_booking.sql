-- Confirmación directa de citas (bookingMode = "confirmacion_directa") y pase de cita. Idempotente.
-- Ejecutar después de 20260925_create_appointments.sql, 20260927_after_hours_metrics.sql y 20260929_live_inbox.sql.
-- Sin esta migración el bot sigue funcionando: en modo "solicitud" no la necesita y en "confirmacion_directa"
-- guarda la cita como solicitud (recepción confirma) hasta que se ejecute.

-- Código corto de la cita (el QR del pase contiene SOLO este código), especialista y quién confirmó.
ALTER TABLE IF EXISTS public.appointments ADD COLUMN IF NOT EXISTS code TEXT;
ALTER TABLE IF EXISTS public.appointments ADD COLUMN IF NOT EXISTS specialist TEXT;
ALTER TABLE IF EXISTS public.appointments ADD COLUMN IF NOT EXISTS confirmed_by TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS appointments_clinic_code_uidx
  ON public.appointments (clinic_id, code) WHERE code IS NOT NULL;

-- Reserva atómica: un candado por clínica y día serializa las reservas; si el horario se solapa con una cita
-- activa (contando la duración), falla con SLOT_TAKEN y el bot ofrece horarios nuevos. Gana el primero.
CREATE OR REPLACE FUNCTION public.reserve_appointment(
  p_clinic_id TEXT, p_sender_phone TEXT, p_patient_name TEXT, p_treatment TEXT,
  p_date DATE, p_time TIME, p_duration INTEGER, p_source TEXT, p_ad_referral JSONB,
  p_code TEXT, p_specialist TEXT, p_after_hours BOOLEAN, p_is_test BOOLEAN
) RETURNS public.appointments
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  new_row public.appointments;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_clinic_id || ':' || p_date::text, 0));
  IF EXISTS (
    SELECT 1 FROM public.appointments a
    WHERE a.clinic_id = p_clinic_id
      AND a.appointment_date = p_date
      AND a.status IN ('pendiente', 'confirmada', 'reprogramada')
      AND a.appointment_time < p_time + make_interval(mins => p_duration)
      AND p_time < a.appointment_time + make_interval(mins => a.duration_min)
  ) THEN
    RAISE EXCEPTION 'SLOT_TAKEN' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.appointments (
    clinic_id, sender_phone, patient_name, treatment, appointment_date, appointment_time, duration_min,
    status, source, ad_referral, code, specialist, after_hours, is_test, confirmed_at, confirmed_by
  ) VALUES (
    p_clinic_id, p_sender_phone, p_patient_name, p_treatment, p_date, p_time, p_duration,
    'confirmada', COALESCE(p_source, 'whatsapp'), p_ad_referral, p_code, p_specialist,
    COALESCE(p_after_hours, FALSE), COALESCE(p_is_test, FALSE), NOW(), 'bot'
  ) RETURNING * INTO new_row;
  RETURN new_row;
END;
$$;

-- Solo el servidor (service role) puede reservar.
REVOKE ALL ON FUNCTION public.reserve_appointment(TEXT, TEXT, TEXT, TEXT, DATE, TIME, INTEGER, TEXT, JSONB, TEXT, TEXT, BOOLEAN, BOOLEAN) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.reserve_appointment(TEXT, TEXT, TEXT, TEXT, DATE, TIME, INTEGER, TEXT, JSONB, TEXT, TEXT, BOOLEAN, BOOLEAN) FROM anon, authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.reserve_appointment(TEXT, TEXT, TEXT, TEXT, DATE, TIME, INTEGER, TEXT, JSONB, TEXT, TEXT, BOOLEAN, BOOLEAN) TO service_role;
  END IF;
END $$;
