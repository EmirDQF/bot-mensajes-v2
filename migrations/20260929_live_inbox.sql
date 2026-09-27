-- Bandeja en vivo del panel (reemplaza Chatwoot). Idempotente: se puede ejecutar más de una vez.
-- messages: quién escribió (paciente, bot o recepción), tipo y media de Meta, y estado de entrega.
-- conversations: no leídos, último mensaje del paciente y motivo del pase a humano.
-- is_test marca lo generado por el Probador del panel (se borra con "Borrar pruebas").

ALTER TABLE IF EXISTS public.messages ADD COLUMN IF NOT EXISTS sender TEXT;
ALTER TABLE IF EXISTS public.messages ADD COLUMN IF NOT EXISTS msg_type TEXT NOT NULL DEFAULT 'text';
ALTER TABLE IF EXISTS public.messages ADD COLUMN IF NOT EXISTS media_id TEXT;
ALTER TABLE IF EXISTS public.messages ADD COLUMN IF NOT EXISTS media_url TEXT;
ALTER TABLE IF EXISTS public.messages ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE IF EXISTS public.messages ADD COLUMN IF NOT EXISTS status_error TEXT;
ALTER TABLE IF EXISTS public.messages ADD COLUMN IF NOT EXISTS status_at TIMESTAMPTZ;
ALTER TABLE IF EXISTS public.messages ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE IF EXISTS public.conversations ADD COLUMN IF NOT EXISTS unread_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE IF EXISTS public.conversations ADD COLUMN IF NOT EXISTS last_inbound_at TIMESTAMPTZ;
ALTER TABLE IF EXISTS public.conversations ADD COLUMN IF NOT EXISTS handoff_reason TEXT;
ALTER TABLE IF EXISTS public.conversations ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE IF EXISTS public.appointments ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
  IF to_regclass('public.messages') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS messages_whatsapp_message_id_idx ON public.messages (whatsapp_message_id);
  END IF;
END $$;
