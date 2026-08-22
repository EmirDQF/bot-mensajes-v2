// Centralized environment loader and validator
// - Validates presence of required variables (fail-fast)
// - Exposes a config object for the app
// - Exposes helpers to mask secrets in logs

const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.PHONE_NUMBER_ID || null;
const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || process.env.VERIFY_TOKEN || null;
if (phoneNumberId) process.env.WHATSAPP_PHONE_NUMBER_ID = phoneNumberId;
if (verifyToken) process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = verifyToken;

const required = [
  'GEMINI_API_KEY',
  'GEMINI_MODEL',
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_WEBHOOK_VERIFY_TOKEN',
  'SUPABASE_URL',
];

const missing = required.filter((k) => !process.env[k]);
const missingServiceRoleKey = !process.env.SUPABASE_SERVICE_ROLE_KEY && !process.env.SUPABASE_SERVICE_ROLE;
if (missingServiceRoleKey) {
  missing.push('SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_ROLE');
}

const nodeEnv = String(process.env.NODE_ENV || '').toLowerCase();
const isTest = nodeEnv === 'test';
const isProd = nodeEnv === 'production';

// In production require WHATSAPP_TOKEN and ADMIN_WHATSAPP_NUMBER to ensure outbound notifications work
if (isProd) {
  if (!process.env.WHATSAPP_TOKEN) missing.push('WHATSAPP_TOKEN');
  if (!process.env.ADMIN_WHATSAPP_NUMBER) missing.push('ADMIN_WHATSAPP_NUMBER');
}

// In test environment allow missing vars to facilitate unit tests
if (missing.length) {
  if (isTest) {
    // warn but don't throw in tests
    console.warn(`(test mode) Missing env vars: ${missing.join(', ')} — continuing for tests.`);
  } else {
    // Fail-fast with a concise message that does NOT print secret values
    throw new Error(`Missing required environment variables: ${missing.join(', ')}. Add them to your .env or env provider before starting.`);
  }
}

function maskSecret(value) {
  if (!value) return value;
  // show only last 4 chars for tokens
  if (value.length <= 8) return '<redacted>';
  return '****' + value.slice(-4);
}

function maskPhone(phone) {
  if (!phone) return phone;
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length <= 4) return '****';
  return '****' + digits.slice(-4);
}

export default {
  gemini: {
    apiKey: process.env.GEMINI_API_KEY,
    model: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
    maxOutputTokens: Number(process.env.GEMINI_MAX_OUTPUT_TOKENS || 4096),
  },
  clinicNameFallback: process.env.CLINIC_NAME_FALLBACK || process.env.CLINIC_NAME || 'LUMINZU Dent',
  clinicProfile: {
    name: process.env.CLINIC_NAME || process.env.CLINIC_NAME_FALLBACK || 'LUMINZU Dent',
    address: process.env.CLINIC_ADDRESS || process.env.DIRECCION_O_SEDES || '📍 Av. Alameda de la República 286 - Huánuco',
    hours: process.env.CLINIC_HOURS || process.env.HORARIOS || 'Lunes a Sábado: 9:00 a. m. – 8:00 p. m. | Domingo: CERRADO',
    contactPhone: process.env.CLINIC_CONTACT_PHONE || process.env.NUMERO_RESPALDO || process.env.ADMIN_WHATSAPP_NUMBER || 'Contáctanos por WhatsApp',
    doctorName: process.env.CLINIC_DOCTOR_NAME || process.env.NOMBRE_DOCTOR_A || 'equipo de LUMINZU Dent',
    bracketsEvaluationPrice: process.env.CLINIC_BRACKETS_EVAL_PRICE || process.env.PRECIO_EVALUACION_ORTODONCIA || 'S/ 40 (promo)',
    initialBracketsPrice: process.env.CLINIC_BRACKETS_INITIAL_PRICE || process.env.PRECIO_INICIAL_BRACKETS || 'S/ 600 (promo / requiere evaluación)',
    monthlyControlPrice: process.env.CLINIC_BRACKETS_MONTHLY_PRICE || process.env.PRECIO_MENSUALIDAD || 'Consulta para definir plan',
    bracketsTypes: process.env.CLINIC_BRACKETS_TYPES || process.env.TIPOS_BRACKETS || 'Consulta previa para definir plan',
    cleaningPrice: process.env.CLINIC_CLEANING_PRICE || process.env.PRECIO_LIMPIEZA || 'S/ 150 (promo / kit preventivo)',
    cleaningIncludes: process.env.CLINIC_CLEANING_DETAILS || process.env.DETALLE_LIMPIEZA || 'Consulta odontológica + profilaxis + destartraje + fluorización + evaluación de ortodoncia',
    whiteningPrice: process.env.CLINIC_WHITENING_PRICE || process.env.PRECIO_BLANQUEAMIENTO || 'Consulta personalizada',
    curationsPrice: process.env.CLINIC_CURATIONS_PRICE || process.env.PRECIO_CURACIONES || 'Consulta personalizada',
    extractionsPrice: process.env.CLINIC_EXTRACTIONS_PRICE || process.env.PRECIO_EXTRACCIONES || 'Consulta personalizada',
  },
  whatsapp: {
    token: process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN || null,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.PHONE_NUMBER_ID || null,
    appSecret: process.env.WHATSAPP_APP_SECRET || null,
    webhookVerifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || process.env.VERIFY_TOKEN || null,
  },
  supabase: {
    url: process.env.SUPABASE_URL || null,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || null,
  },
  admin: {
    phone: process.env.ADMIN_WHATSAPP_NUMBER || null,
  },
  server: {
    port: Number(process.env.PORT || 3000),
  },
  clinicHours: {
    // Default clinic schedule: lunes(1) .. sábado(6). Domingo (0) no atendemos.
    diasAtencion: [1,2,3,4,5,6],
    horaInicio: process.env.CLINIC_HOUR_START || '09:00',
    horaFin: process.env.CLINIC_HOUR_END || '19:00'
  },
  helpers: {
    maskSecret,
    maskPhone,
  },
};
