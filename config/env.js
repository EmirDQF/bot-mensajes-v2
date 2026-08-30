const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.PHONE_NUMBER_ID || null;
const webhookVerifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN
  || process.env.VERIFY_TOKEN
  || process.env.WEBHOOK_VERIFY_TOKEN
  || null;

export default {
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || null,
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    maxOutputTokens: Number(process.env.GEMINI_MAX_OUTPUT_TOKENS || 100),
  },
  clinicNameFallback: process.env.CLINIC_NAME_FALLBACK || 'nuestra clínica dental',
  clinicProfile: {
    name: process.env.CLINIC_NAME || process.env.CLINIC_NAME_FALLBACK || 'LUMINZU Clínica Dental',
    address: process.env.CLINIC_ADDRESS
      || process.env.DIRECCION_O_SEDES
      || '📍 Av. Alameda de la República N° 261 - Huánuco',
    hours: process.env.CLINIC_HOURS
      || process.env.HORARIOS
      || 'Lunes a sábado de 9:00 a. m. a 8:00 p. m.',
  },
  whatsapp: {
    token: process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN || null,
    phoneNumberId,
    appSecret: process.env.WHATSAPP_APP_SECRET || null,
    webhookVerifyToken,
  },
  supabase: {
    url: process.env.SUPABASE_URL || null,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY
      || process.env.SUPABASE_SERVICE_ROLE
      || null,
  },
  admin: {
    phone: process.env.ADMIN_WHATSAPP_NUMBER || null,
  },
  server: {
    port: Number(process.env.PORT || 3000),
  },
};
