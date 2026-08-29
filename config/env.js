// Centralized environment loader and validator
// - Validates presence of required variables (fail-fast)
// - Exposes a config object for the app
// - Exposes helpers to mask secrets in logs

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || null;
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.PHONE_NUMBER_ID || null;
const WEBHOOK_VERIFY_TOKEN = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || process.env.WEBHOOK_VERIFY_TOKEN || null;
const SUPABASE_URL = process.env.SUPABASE_URL || null;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_KEY || null;

const required = [
  'GEMINI_API_KEY',
  'GEMINI_MODEL',
  'WHATSAPP_TOKEN',
  'PHONE_NUMBER_ID',
  'WEBHOOK_VERIFY_TOKEN',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
];

const missing = required.filter((k) => {
  switch (k) {
    case 'WHATSAPP_TOKEN': return !WHATSAPP_TOKEN;
    case 'PHONE_NUMBER_ID': return !PHONE_NUMBER_ID;
    case 'WEBHOOK_VERIFY_TOKEN': return !WEBHOOK_VERIFY_TOKEN;
    case 'SUPABASE_URL': return !SUPABASE_URL;
    case 'SUPABASE_SERVICE_ROLE_KEY': return !SUPABASE_KEY;
    default: return !process.env[k];
  }
});

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
    maxOutputTokens: Number(process.env.GEMINI_MAX_OUTPUT_TOKENS || 110),
  },
  clinicNameFallback: process.env.CLINIC_NAME_FALLBACK || process.env.CLINIC_NAME || 'nuestra clínica dental',
  clinicProfile: {
    name: process.env.CLINIC_NAME || process.env.CLINIC_NAME_FALLBACK || 'nuestra clínica dental',
    address: process.env.CLINIC_ADDRESS || process.env.DIRECCION_O_SEDES || 'Av. Principal 123, Los Olivos',
    hours: process.env.CLINIC_HOURS || process.env.HORARIOS || 'Lunes a Sábado de 9:00 AM a 8:00 PM',
    contactPhone: process.env.CLINIC_CONTACT_PHONE || process.env.NUMERO_RESPALDO || process.env.ADMIN_WHATSAPP_NUMBER || '+51 999 999 999',
    doctorName: process.env.CLINIC_DOCTOR_NAME || process.env.NOMBRE_DOCTOR_A || 'Dr(a).',
    bracketsEvaluationPrice: process.env.CLINIC_BRACKETS_EVAL_PRICE || process.env.PRECIO_EVALUACION_ORTODONCIA || 'Gratis / S/ 30',
    initialBracketsPrice: process.env.CLINIC_BRACKETS_INITIAL_PRICE || process.env.PRECIO_INICIAL_BRACKETS || 'Desde S/ 1,500',
    monthlyControlPrice: process.env.CLINIC_BRACKETS_MONTHLY_PRICE || process.env.PRECIO_MENSUALIDAD || 'Desde S/ 180',
    bracketsTypes: process.env.CLINIC_BRACKETS_TYPES || process.env.TIPOS_BRACKETS || 'Metálicos, Estéticos, Autoligados',
    cleaningPrice: process.env.CLINIC_CLEANING_PRICE || process.env.PRECIO_LIMPIEZA || 'S/ 120',
    cleaningIncludes: process.env.CLINIC_CLEANING_DETAILS || process.env.DETALLE_LIMPIEZA || 'Ultrasonido + Pulido + Fluorización',
    whiteningPrice: process.env.CLINIC_WHITENING_PRICE || process.env.PRECIO_BLANQUEAMIENTO || 'Consulta',
    curationsPrice: process.env.CLINIC_CURATIONS_PRICE || process.env.PRECIO_CURACIONES || 'Consulta',
    extractionsPrice: process.env.CLINIC_EXTRACTIONS_PRICE || process.env.PRECIO_EXTRACCIONES || 'Consulta',
  },
  whatsapp: {
    token: WHATSAPP_TOKEN,
    phoneNumberId: PHONE_NUMBER_ID,
    appSecret: process.env.WHATSAPP_APP_SECRET || null,
    webhookVerifyToken: WEBHOOK_VERIFY_TOKEN,
  },
  supabase: {
    url: SUPABASE_URL,
    serviceRoleKey: SUPABASE_KEY,
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
