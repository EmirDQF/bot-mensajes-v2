-- conversations.first_response_ms pasa de INTEGER a BIGINT.
-- En producción falló: [Metrics] value "288915076252" is out of range for type integer (máximo 2147483647 ms).
-- El código ya descarta tiempos imposibles (> 7 días); BIGINT evita que un valor raro rompa el guardado.
-- Idempotente: se puede ejecutar más de una vez. Ejecutar después de 20260927_after_hours_metrics.sql.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'conversations'
      AND column_name = 'first_response_ms' AND data_type = 'integer'
  ) THEN
    ALTER TABLE public.conversations ALTER COLUMN first_response_ms TYPE BIGINT;
  END IF;
END $$;
