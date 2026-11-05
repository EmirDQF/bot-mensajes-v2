-- Panel "Mi clínica": tipo de acción en el historial de cambios (cambio, restaurar, deshacer). Idempotente.
-- Ejecutar después de 20260929_clinic_settings.sql. Sin esta migración el historial y "Deshacer el último cambio"
-- funcionan igual; solo no se distingue el tipo de acción.
ALTER TABLE IF EXISTS public.clinic_settings_audit ADD COLUMN IF NOT EXISTS action TEXT NOT NULL DEFAULT 'cambio';
