-- Idempotent tracking for outbound catalog images and campaign welcome sends.
CREATE TABLE IF NOT EXISTS public.whatsapp_media_sends (
  id BIGSERIAL PRIMARY KEY,
  recipient TEXT NOT NULL,
  image_key TEXT NOT NULL,
  campaign_key TEXT NOT NULL DEFAULT 'catalog',
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT whatsapp_media_sends_status CHECK (status IN ('pending', 'sent', 'failed')),
  CONSTRAINT whatsapp_media_sends_unique_send UNIQUE (recipient, image_key, campaign_key)
);

-- Índice compuesto para optimizar las consultas por destinatario y campaña
CREATE INDEX IF NOT EXISTS idx_whatsapp_media_sends_recipient_campaign
  ON public.whatsapp_media_sends (recipient, campaign_key);

-- Trigger opcional pero recomendado para actualizar automáticamente el campo updated_at
CREATE OR REPLACE FUNCTION public.update_whatsapp_media_sends_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_whatsapp_media_sends_updated_at ON public.whatsapp_media_sends;

CREATE TRIGGER trg_whatsapp_media_sends_updated_at
  BEFORE UPDATE ON public.whatsapp_media_sends
  FOR EACH ROW
  EXECUTE FUNCTION public.update_whatsapp_media_sends_updated_at();