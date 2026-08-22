import fs from 'fs/promises';
import path from 'path';

// Lightweight .env parser in case dotenv isn't installed in the environment
async function loadDotEnv() {
  const env = { ...process.env };
  try {
    const p = path.resolve(process.cwd(), '.env');
    const content = await fs.readFile(p, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!(key in env)) env[key] = val;
    }
  } catch (e) {
    // ignore if .env not present
  }
  return env;
}

function maskToken(token) {
  if (!token) return undefined;
  return token.length > 10 ? `${token.slice(0, 6)}...${token.slice(-4)}` : token;
}

(async function main() {
  const env = await loadDotEnv();
  const WHATSAPP_TOKEN = env.WHATSAPP_TOKEN;
  const WHATSAPP_PHONE_NUMBER_ID = env.WHATSAPP_PHONE_NUMBER_ID;
  const WABA_ID = env.WABA_ID || env.WHATSAPP_WABA_ID || env.WHATSAPP_WABA || env.WABA;
  const TEST_TO = env.TEST_WHATSAPP_NUMBER; // optional, e.g. 51977123456

  console.log('Starting restore-whatsapp diagnostic script');

  if (!WHATSAPP_TOKEN) {
    console.error('Missing WHATSAPP_TOKEN in process.env or .env. Aborting.');
    process.exitCode = 2;
    return;
  }
  if (!WHATSAPP_PHONE_NUMBER_ID) {
    console.error('Missing WHATSAPP_PHONE_NUMBER_ID in process.env or .env. Aborting.');
    process.exitCode = 2;
    return;
  }
  if (!WABA_ID) {
    console.error('Missing WABA_ID in process.env or .env. Aborting.');
    process.exitCode = 2;
    return;
  }

  console.log('Using WABA_ID:', WABA_ID);
  console.log('Using PHONE_NUMBER_ID:', WHATSAPP_PHONE_NUMBER_ID);
  console.log('Using WHATSAPP_TOKEN (masked):', maskToken(WHATSAPP_TOKEN));

  const headers = {
    Authorization: `Bearer ${WHATSAPP_TOKEN}`,
    'Content-Type': 'application/json'
  };

  // 1) POST to subscribe the app to the WABA
  try {
    console.log('Requesting subscription for WABA -> POST /subscribed_apps');
    const subRes = await fetch(`https://graph.facebook.com/v20.0/${WABA_ID}/subscribed_apps`, {
      method: 'POST',
      headers,
      body: JSON.stringify({})
    });
    const subText = await subRes.text();
    let subJson = null;
    try { subJson = JSON.parse(subText); } catch(e) { /* not JSON */ }
    console.log('POST /subscribed_apps status=', subRes.status);
    console.log('POST /subscribed_apps body=', subJson ?? subText);
  } catch (e) {
    console.error('Error while POST /subscribed_apps:', e && e.message ? e.message : e);
  }

  // 2) GET to verify subscriptions
  try {
    console.log('Verifying subscription -> GET /subscribed_apps');
    const getRes = await fetch(`https://graph.facebook.com/v20.0/${WABA_ID}/subscribed_apps`, {
      method: 'GET',
      headers
    });
    const txt = await getRes.text();
    let json = null;
    try { json = JSON.parse(txt); } catch (e) {}
    console.log('GET /subscribed_apps status=', getRes.status);
    console.log('GET /subscribed_apps body=', json ?? txt);
  } catch (e) {
    console.error('Error while GET /subscribed_apps:', e && e.message ? e.message : e);
  }

  // 3) Optional: send test outgoing message
  if (!TEST_TO) {
    console.warn('TEST_WHATSAPP_NUMBER not set. Skipping outgoing test message. If you want to send one, set TEST_WHATSAPP_NUMBER in .env (e.g. 51977123456)');
    return;
  }

  try {
    console.log(`Sending test message to ${TEST_TO} via PHONE_NUMBER_ID ${WHATSAPP_PHONE_NUMBER_ID}`);
    const payload = {
      messaging_product: 'whatsapp',
      to: TEST_TO,
      type: 'text',
      text: { body: 'Prueba: mensaje enviado desde script restore-whatsapp.js' }
    };
    const sendRes = await fetch(`https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
    const sendTxt = await sendRes.text();
    let sendJson = null;
    try { sendJson = JSON.parse(sendTxt); } catch(e){}
    console.log('POST /messages status=', sendRes.status);
    console.log('POST /messages body=', sendJson ?? sendTxt);
    if (sendRes.status === 401) {
      console.error('Received 401 unauthorized when sending message. Token invalid or expired.');
    }
  } catch (e) {
    console.error('Error while sending test message:', e && e.message ? e.message : e);
  }
})();
