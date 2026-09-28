-- Tablas messages heredadas de un panel anterior pueden traer columnas NOT NULL sin valor por defecto que el bot
-- no llena (p. ej. "timestamp"). Con ellas cada INSERT falla y la bandeja del panel queda vacía:
--   null value in column "timestamp" of relation "messages" violates not-null constraint
-- Idempotente: "timestamp" pasa a DEFAULT NOW() y cualquier otra columna ajena al bot deja de ser obligatoria.
DO $$
DECLARE
  col RECORD;
BEGIN
  IF to_regclass('public.messages') IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'messages' AND column_name = 'timestamp') THEN
    ALTER TABLE public.messages ALTER COLUMN "timestamp" SET DEFAULT NOW();
  END IF;

  FOR col IN
    SELECT c.column_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = 'messages'
      AND c.is_nullable = 'NO' AND c.column_default IS NULL AND c.is_identity = 'NO'
      AND c.column_name NOT IN ('id', 'phone', 'role')
  LOOP
    EXECUTE format('ALTER TABLE public.messages ALTER COLUMN %I DROP NOT NULL', col.column_name);
  END LOOP;
END $$;
