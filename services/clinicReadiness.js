import { activeTreatments, findTodos, normalizePhone } from '../config/clinic.config.js';

// "Configuración completa: X de Y" del panel Mi clínica: qué falta para conectar pacientes reales.
// Solo dice SI una variable está definida, nunca su valor. `section` indica dónde se corrige en el panel.

const hasText = (value) => typeof value === 'string' && value.trim().length > 0;
const env = (vars, name) => hasText(vars[name]);

export function readiness(c, vars = process.env) {
  const active = activeTreatments(c);
  const openDays = Object.values(c.workingHours || {}).filter((ranges) => Array.isArray(ranges) && ranges.length).length;
  const items = [
    // Datos de la clínica (se completan en el panel)
    { id: 'name', label: 'Nombre de la clínica', ok: hasText(c.name), section: 'data' },
    { id: 'address', label: 'Dirección y enlace de Google Maps', ok: hasText(c.address) && /^https:\/\//.test(c.mapsUrl || ''), section: 'data' },
    { id: 'logo', label: 'Logo', ok: hasText(c.media?.logo), section: 'data' },
    { id: 'hours', label: 'Horario de atención (al menos un día)', ok: openDays > 0 && hasText(c.workingHoursText), section: 'hours' },
    { id: 'treatments', label: 'Al menos un tratamiento activo con precio "desde"', ok: active.some((t) => Number(t.priceFrom) > 0), section: 'treatments' },
    { id: 'payments', label: 'Medios de pago', ok: (c.paymentMethods || []).length > 0, section: 'payments' },
    { id: 'faq', label: 'Al menos 3 preguntas frecuentes', ok: (c.faq || []).length >= 3, section: 'faq' },
    { id: 'pack', label: 'Pack de evaluación (qué incluye y precio)', ok: Boolean(c.evaluationPack?.title && c.evaluationPack?.includes?.length), section: 'pack' },
    { id: 'welcome', label: 'Mensaje de bienvenida', ok: hasText(c.welcomeCaption), section: 'assistant' },
    { id: 'todos', label: 'Sin datos "TODO" pendientes en el archivo de la clínica', ok: findTodos(c).length === 0, section: null },
    // Conexión (se configuran en Render → Environment; el panel solo dice si existen)
    { id: 'phones', label: 'Teléfonos de la clínica, recepción y dueño (CLINIC_PHONE, RECEPTION_ALERT_PHONE, OWNER_ALERT_PHONE)', ok: ['CLINIC_PHONE', 'RECEPTION_ALERT_PHONE', 'OWNER_ALERT_PHONE'].every((name) => normalizePhone(vars[name])), section: 'env' },
    { id: 'whatsapp', label: 'WhatsApp Cloud API (token, número, secreto de la app y token del webhook)', ok: ['WHATSAPP_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_APP_SECRET', 'WHATSAPP_WEBHOOK_VERIFY_TOKEN'].every((name) => env(vars, name)), section: 'env' },
    { id: 'signature', label: 'Firma de Meta obligatoria (ENFORCE_WHATSAPP_SIGNATURE=true)', ok: vars.ENFORCE_WHATSAPP_SIGNATURE === 'true', section: 'env' },
    { id: 'gemini', label: 'Clave de Gemini (GEMINI_API_KEY)', ok: env(vars, 'GEMINI_API_KEY'), section: 'env' },
    { id: 'supabase', label: 'Base de datos (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY)', ok: env(vars, 'SUPABASE_URL') && env(vars, 'SUPABASE_SERVICE_ROLE_KEY'), section: 'env' },
    { id: 'cron', label: 'Tareas programadas (CRON_SECRET y PUBLIC_BASE_URL)', ok: env(vars, 'CRON_SECRET') && /^https:\/\//.test(vars.PUBLIC_BASE_URL || ''), section: 'env' },
  ];
  const done = items.filter((i) => i.ok).length;
  return { done, total: items.length, complete: done === items.length, items, missing: items.filter((i) => !i.ok) };
}

export default readiness;
