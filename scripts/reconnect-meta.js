import fs from 'fs';
import path from 'path';

const FALLBACK_WABA_ID = '1363917525928617';
const FALLBACK_PHONE_NUMBER_ID = '1337494962770981';

const colors = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  green: '\u001b[32m',
  red: '\u001b[31m',
  yellow: '\u001b[33m',
  cyan: '\u001b[36m',
  dim: '\u001b[2m',
};

function loadDotEnv(filePath = path.resolve(process.cwd(), '.env')) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const idx = trimmed.indexOf('=');
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

function printColor(color, text) {
  console.log(`${colors[color]}${text}${colors.reset}`);
}

function getEnvValue(key, fallback) {
  return process.env[key] || fallback;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...(options.body ? { body: options.body } : {}),
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

async function main() {
  loadDotEnv();

  const wabaId = getEnvValue('WABA_ID', FALLBACK_WABA_ID);
  const phoneNumberId = getEnvValue('WHATSAPP_PHONE_NUMBER_ID', FALLBACK_PHONE_NUMBER_ID);
  const token = process.env.WHATSAPP_TOKEN;

  console.log('');
  printColor('cyan', '=== Meta WhatsApp reconnect diagnostic ===');
  console.log(`WABA_ID: ${wabaId}`);
  console.log(`WHATSAPP_PHONE_NUMBER_ID: ${phoneNumberId}`);
  console.log(`WHATSAPP_TOKEN: ${token ? `${token.slice(0, 8)}...${token.slice(-4)}` : 'MISSING'}`);
  console.log('');

  if (!token) {
    printColor('red', 'ERROR: WHATSAPP_TOKEN no está definido en el entorno o .env.');
    printColor('yellow', 'Agregar en .env: WHATSAPP_TOKEN=tu_token');
    process.exit(1);
  }

  const subscribedUrl = `https://graph.facebook.com/v20.0/${wabaId}/subscribed_apps`;
  const headers = {
    Authorization: `Bearer ${token}`,
  };

  try {
    printColor('yellow', '1) Re-suscribiendo WABA a la app de Meta...');
    const subscribeResult = await fetchJson(subscribedUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });

    console.log('HTTP status:', subscribeResult.status, subscribeResult.statusText);
    console.log('Response:', JSON.stringify(subscribeResult.payload, null, 2));

    if (subscribeResult.ok && subscribeResult.payload && subscribeResult.payload.success === true) {
      printColor('green', '✅ Suscripción exitosa: Meta respondió { success: true }');
    } else {
      printColor('red', '❌ La suscripción no fue aceptada. Meta devolvió un error.');
      if (subscribeResult.payload && subscribeResult.payload.error) {
        console.log('Error details:', JSON.stringify(subscribeResult.payload.error, null, 2));
      }
    }

    console.log('');
    printColor('yellow', '2) Verificando app suscrita en la WABA...');
    const verifyResult = await fetchJson(`${subscribedUrl}?access_token=${encodeURIComponent(token)}`, {
      method: 'GET',
      headers,
    });

    console.log('HTTP status:', verifyResult.status, verifyResult.statusText);
    console.log('Response:', JSON.stringify(verifyResult.payload, null, 2));

    if (verifyResult.ok && verifyResult.payload && Array.isArray(verifyResult.payload.data)) {
      const appEntry = verifyResult.payload.data.find((item) => String(item.id) === String(wabaId) || item.id === 'app');
      if (appEntry || verifyResult.payload.data.length > 0) {
        printColor('green', '✅ La WABA está reportando la app suscrita en Graph API.');
      } else {
        printColor('red', '❌ La WABA no aparece como suscrita a la app.');
      }
    }

    console.log('');
    printColor('yellow', '3) Verificando validez del token y permisos...');
    const tokenCheck = await fetchJson(`https://graph.facebook.com/v20.0/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(token)}`, {
      method: 'GET',
    });

    console.log('HTTP status:', tokenCheck.status, tokenCheck.statusText);
    console.log('Response:', JSON.stringify(tokenCheck.payload, null, 2));

    if (tokenCheck.ok && tokenCheck.payload && tokenCheck.payload.data) {
      if (tokenCheck.payload.data.is_valid) {
        printColor('green', '✅ Token válido y activo.');
      } else {
        printColor('red', '❌ Token inválido o expirado.');
      }
    }

    console.log('');
    printColor('cyan', '=== Instrucciones rápidas ===');
    console.log('1) Confirma en Meta Developers que la App está asociada a la WABA correcta.');
    console.log('2) Asegúrate de que la URL del webhook sea: https://bot-mensajes-dental.onrender.com/webhook');
    console.log('3) Verifica el campo de suscripción: messages');
    console.log('4) Haz redeploy en Render y prueba con un mensaje real en WhatsApp.');
    console.log('5) Revisa el log del servidor para ver [INCOMING HTTP] y [WEBHOOK BODY].');
  } catch (error) {
    printColor('red', 'ERROR fatal al intentar reconectar la WABA con Meta:');
    console.error(error);
    process.exit(1);
  }
}

main();
