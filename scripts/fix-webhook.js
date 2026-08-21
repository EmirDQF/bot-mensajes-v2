import fs from 'fs';
import path from 'path';

const REQUIRED_ENV_VARS = [
  'WHATSAPP_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID',
  'WABA_ID',
  'WHATSAPP_WEBHOOK_VERIFY_TOKEN',
];

function loadDotEnv(filePath = path.resolve(process.cwd(), '.env')) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const eqIndex = trimmed.indexOf('=');
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value.replace(/^['"]|['"]$/g, '');
    }
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }

  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    payload,
  };
}

function ensureEnv() {
  loadDotEnv();
  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
  if (missing.length) {
    console.error('❌ Faltan variables de entorno requeridas:');
    for (const key of missing) {
      console.error(`   - ${key}`);
    }
    console.error('');
    console.error('Crea o actualiza tu .env con algo como:');
    console.error('  WHATSAPP_TOKEN=tu_token');
    console.error('  WHATSAPP_PHONE_NUMBER_ID=tu_phone_number_id');
    console.error('  WABA_ID=1363917525928617');
    console.error('  WHATSAPP_WEBHOOK_VERIFY_TOKEN=tu_verify_token');
    process.exit(1);
  }

  const wabaId = process.env.WABA_ID || '1363917525928617';
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;

  console.log('✅ Variables de entorno detectadas.');
  console.log(`   WABA_ID: ${wabaId}`);
  console.log(`   WHATSAPP_PHONE_NUMBER_ID: ${phoneId}`);
  console.log(`   WHATSAPP_TOKEN: ${token.slice(0, 6)}...${token.slice(-4)}`);
  console.log(`   WHATSAPP_WEBHOOK_VERIFY_TOKEN: ${verifyToken ? 'configurado' : 'faltante'}`);
  console.log('');
}

async function verifyTokenPermissions(token) {
  const endpoints = [
    `https://graph.facebook.com/v20.0/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(token)}`,
    `https://graph.facebook.com/v20.0/me?fields=id,name&access_token=${encodeURIComponent(token)}`,
  ];

  for (const url of endpoints) {
    console.log(`🔎 Consultando: ${url}`);
    const result = await fetchJson(url, { method: 'GET' });
    console.log('   HTTP:', result.status, result.statusText);
    console.log('   Body:', JSON.stringify(result.payload, null, 2));
    console.log('');

    if (result.ok && result.payload?.data) {
      if (result.payload.data.is_valid === false) {
        console.warn('⚠️ El token no es válido o no tiene permisos suficientes.');
      }
      if (result.payload.data.scopes) {
        console.log('   Scopes disponibles:', result.payload.data.scopes.join(', '));
      }
    }
  }
}

async function subscribeWabaToApp() {
  const wabaId = process.env.WABA_ID;
  const token = process.env.WHATSAPP_TOKEN;
  const url = `https://graph.facebook.com/v20.0/${wabaId}/subscribed_apps?access_token=${encodeURIComponent(token)}`;

  console.log('📨 Re-suscribiendo la WABA a la app de Meta...');
  console.log(`URL: ${url}`);

  const result = await fetchJson(url, {
    method: 'POST',
    body: JSON.stringify({}),
  });

  console.log('HTTP:', result.status, result.statusText);
  console.log('Response body:', JSON.stringify(result.payload, null, 2));
  console.log('');

  if (result.ok && result.payload && result.payload.success === true) {
    console.log('✅ Suscripción confirmada: { success: true }');
    return true;
  }

  console.error('❌ La re-suscripción no fue exitosa. Revisa el token, permisos y WABA_ID.');
  return false;
}

async function main() {
  ensureEnv();

  const token = process.env.WHATSAPP_TOKEN;
  await verifyTokenPermissions(token);
  const ok = await subscribeWabaToApp();

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('INSTRUCCIONES PARA DEPURAR EL WEBHOOK');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('1) Asegúrate de que tu app de Meta esté suscrita al campo: messages');
  console.log('2) Verifica que la URL sea: https://bot-mensajes-dental.onrender.com/webhook');
  console.log('3) Confirma el verify token: ' + process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN);
  console.log('4) Inicia el servidor local / en Render: npm start');
  console.log('5) Prueba el webhook con un mensaje de WhatsApp real o con una petición POST manual a /webhook');
  console.log('6) Revisa los logs de Render y busca el timestamp + req.body para el endpoint /webhook');
  console.log('7) Ejecuta este script cuando el webhook haya caído: node scripts/fix-webhook.js');
  console.log('');

  if (ok) {
    console.log('✅ Diagnóstico y re-suscripción completados.');
    process.exit(0);
  }

  process.exit(1);
}

main().catch((error) => {
  console.error('❌ Error fatal al ejecutar el diagnóstico:', error);
  process.exit(1);
});
