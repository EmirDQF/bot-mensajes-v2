import { CLINIC_NAME } from './catalogo.js';
import clinic from './clinic.config.js';

const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.PHONE_NUMBER_ID || null;
const webhookVerifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN
  || process.env.VERIFY_TOKEN
  || process.env.WEBHOOK_VERIFY_TOKEN
  || null;
const configuredGeminiModel = process.env.GEMINI_MODEL;
const geminiModel = configuredGeminiModel && /^gemini-(?:1\.5|2\.0|3\.5)-flash(?:-lite)?$/i.test(configuredGeminiModel)
  ? configuredGeminiModel
  : 'gemini-3.5-flash-lite';

export default {
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || null,
    model: geminiModel,
    maxOutputTokens: Number(process.env.GEMINI_MAX_OUTPUT_TOKENS || 100),
  },
  clinicNameFallback: 'nuestra clínica dental',
  // Datos de la clínica activa: vienen de config/clinics/<ACTIVE_CLINIC>.js
  clinicProfile: {
    id: clinic.id,
    name: CLINIC_NAME,
    address: clinic.address,
    hours: clinic.workingHoursText,
  },
  whatsapp: {
    token: process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN || null,
    phoneNumberId,
    appSecret: process.env.WHATSAPP_APP_SECRET || null,
    webhookVerifyToken,
  },
  supabase: {
    // supabase-js agrega /rest/v1 por su cuenta: si la URL ya lo trae, todas las consultas fallan
    // con "Invalid path specified in request URL". Se normaliza a https://<proyecto>.supabase.co
    url: (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '').replace(/\/rest\/v1$/i, '') || null,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY
      || process.env.SUPABASE_SERVICE_ROLE
      || null,
  },
  admin: {
    // Legacy: ADMIN_WHATSAPP_NUMBER se acepta si aún no se define RECEPTION_ALERT_PHONE.
    phone: process.env.RECEPTION_ALERT_PHONE || process.env.ADMIN_WHATSAPP_NUMBER || null,
  },
  server: {
    port: Number(process.env.PORT || 3000),
  },
};
