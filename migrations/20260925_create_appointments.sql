-- Citas agendadas por el asistente de WhatsApp (una fila por solicitud de cita).
-- Idempotente: se puede ejecutar más de una vez en el SQL Editor de Supabase.
-- appointment_date / appointment_time están en la hora local de la clínica (config/clinics/<id>.js → timezone).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id TEXT NOT NULL,
  sender_phone TEXT NOT NULL,
  patient_name TEXT,
  treatment TEXT,
  appointment_date DATE NOT NULL,
  appointment_time TIME NOT NULL,
  duration_min INTEGER NOT NULL DEFAULT 30 CHECK (duration_min > 0),
  status TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (status IN ('pendiente', 'confirmada', 'reprogramada', 'cancelada', 'asistio', 'no_asistio')),
  source TEXT NOT NULL DEFAULT 'whatsapp',
  ad_referral JSONB,
  notes TEXT,
  reminder_24h_sent_at TIMESTAMPTZ,
  reminder_2h_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS appointments_clinic_date_idx ON public.appointments (clinic_id, appointment_date);
CREATE INDEX IF NOT EXISTS appointments_sender_phone_idx ON public.appointments (sender_phone);
CREATE INDEX IF NOT EXISTS appointments_created_at_idx ON public.appointments (created_at);

-- Choque de horario: dos citas activas no pueden empezar a la misma hora en la misma clínica.
-- (El solapamiento por duración lo controla services/appointmentService.js antes de insertar.)
CREATE UNIQUE INDEX IF NOT EXISTS appointments_active_slot_uidx
  ON public.appointments (clinic_id, appointment_date, appointment_time)
  WHERE status IN ('pendiente', 'confirmada', 'reprogramada');

CREATE OR REPLACE FUNCTION public.appointments_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS appointments_set_updated_at ON public.appointments;
CREATE TRIGGER appointments_set_updated_at
  BEFORE UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.appointments_set_updated_at();

-- RLS activado sin políticas públicas: solo el service role (el backend del bot) puede leer y escribir.
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

-- Origen del anuncio (Meta click-to-WhatsApp) también en los leads.
ALTER TABLE IF EXISTS public.leads ADD COLUMN IF NOT EXISTS ad_referral JSONB;
