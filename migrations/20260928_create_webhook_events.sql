-- Deduplicación del webhook de WhatsApp: Meta reintenta el mismo mensaje si el servidor tarda en
-- responder (por ejemplo, cuando Render despierta). Cada message.id se procesa una sola vez.
-- Idempotente. El resumen diario borra los registros de más de 7 días.

CREATE TABLE IF NOT EXISTS public.webhook_events (
  message_id TEXT PRIMARY KEY,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS webhook_events_received_at_idx ON public.webhook_events (received_at);

ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;
