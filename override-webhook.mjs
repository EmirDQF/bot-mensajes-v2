// override-webhook.mjs
// Ejecutar con: node override-webhook.mjs
// Requiere las variables de entorno: WHATSAPP_TOKEN, WHATSAPP_WEBHOOK_VERIFY_TOKEN
// Opcional: WABA_ID, CALLBACK_URL, GRAPH_VERSION

const token = process.env.WHATSAPP_TOKEN;
const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
const wabaId = process.env.WABA_ID || '1363917525928617';
const callbackUrl = process.env.CALLBACK_URL || 'https://bot-mensajes-dental.onrender.com/webhook';
const GRAPH_VERSION = process.env.GRAPH_VERSION || 'v20.0';

function requireEnv(name, value) {
  if (!value) {
    console.error(`❌ Falta la variable de entorno ${name}. Expórtala antes de correr el script.`);
    process.exit(1);
  }
}

requireEnv('WHATSAPP_TOKEN', token);
requireEnv('WHATSAPP_WEBHOOK_VERIFY_TOKEN', verifyToken);

async function postOverride() {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${wabaId}/subscribed_apps`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        override_callback_uri: callbackUrl,
        verify_token: verifyToken
      })
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok || data.error) {
      console.error(`❌ Meta respondió con error (HTTP ${res.status}):`);
      console.error(JSON.stringify(data, null, 2));
      process.exit(1);
    }

    console.log('✅ RESULTADO_OVERRIDE:', JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('❌ Error de red al llamar a Graph API:', err.message || err);
    process.exit(1);
  }
}

async function checkOverride() {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${wabaId}/subscribed_apps`;
  try {
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    const checkData = await res.json().catch(() => ({}));
    console.log('Estado actual de subscribed_apps:', JSON.stringify(checkData, null, 2));

    const app = checkData?.data?.[0];
    if (!app) {
      console.warn('⚠️ No se encontraron entradas en subscribed_apps. Revisa permisos y acceso.');
      return;
    }

    if (app?.override_callback_uri !== callbackUrl) {
      console.warn('⚠️  El override_callback_uri no coincide con el esperado. Revisa manualmente.');
      console.warn('Valor esperado:', callbackUrl);
      console.warn('Valor actual :', app?.override_callback_uri);
    } else {
      console.log('✅ Confirmado: la WABA está apuntando a', callbackUrl);
    }
  } catch (err) {
    console.error('❌ No se pudo verificar el estado:', err.message || err);
  }
}

async function main() {
  console.log('--- 1. ENLAZANDO WEBHOOK DIRECTO A LA WABA ---');
  await postOverride();

  console.log('\n--- 2. VERIFICANDO QUE EL OVERRIDE QUEDÓ REGISTRADO ---');
  await checkOverride();
}

main().catch(err => {
  console.error('❌ Error inesperado:', err);
  process.exit(1);
});
