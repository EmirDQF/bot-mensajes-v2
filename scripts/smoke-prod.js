// npm run smoke:prod -- https://<servicio>.onrender.com [--apply]
// Prueba de extremo a extremo contra producción: salud, seguridad del webhook, jobs y panel protegidos.
// Con --apply además envía la plantilla hello_world a OWNER_ALERT_PHONE y muestra el message id.
// Solo lee el entorno para firmar y autenticarse: nunca imprime secretos.
import crypto from 'crypto';
import { loadEnv, parseArgs, printResults, result, runIfMain, redact } from './lib/cli.js';
import { sendTestTemplate } from './lib/meta.js';

const HEALTH_BUDGET_MS = 1000;

export async function smokeProd(baseUrl, env, { fetchImpl = fetch, apply = false, clock = () => performance.now() } = {}) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  const results = [];
  const hit = async (path, init = {}) => {
    const res = await fetchImpl(`${base}${path}`, { redirect: 'manual', ...init });
    const text = await res.text().catch(() => '');
    return { status: res.status, text };
  };
  const check = async (label, fn) => {
    try {
      results.push(await fn());
    } catch (error) {
      results.push(result('fail', `${label}: ${redact(error.message)}`, 'Revisa la URL y Render → Logs.'));
    }
  };

  await check('/health', async () => {
    await hit('/health'); // despierta el servicio (Render gratis tarda ~50 s tras dormir)
    const started = clock();
    const { status } = await hit('/health');
    const ms = Math.round(clock() - started);
    if (status !== 200) return result('fail', `/health respondió ${status}`, 'Render → Logs: el servicio no arrancó.');
    return result(ms < HEALTH_BUDGET_MS ? 'ok' : 'warn', `/health 200 en ${ms} ms`, ms < HEALTH_BUDGET_MS ? undefined : 'Más de 1 s: si persiste, sube a Render Starter.');
  });

  await check('/health/deep', async () => {
    if (!env.CRON_SECRET) return result('warn', '/health/deep sin probar: falta CRON_SECRET en tu .env');
    const { status, text } = await hit('/health/deep', { headers: { 'x-cron-secret': env.CRON_SECRET } });
    if (status === 200) return result('ok', '/health/deep 200: Supabase responde');
    if (status === 401) return result('fail', '/health/deep 401', 'El CRON_SECRET de tu .env no es igual al de Render.');
    return result('fail', `/health/deep ${status}: ${redact(text.slice(0, 160))}`, 'Revisa SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en Render y que el proyecto no esté pausado.');
  });

  await check('handshake', async () => {
    if (!env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) return result('warn', 'Handshake sin probar: falta WHATSAPP_WEBHOOK_VERIFY_TOKEN en tu .env');
    const challenge = crypto.randomBytes(6).toString('hex');
    const query = new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': env.WHATSAPP_WEBHOOK_VERIFY_TOKEN, 'hub.challenge': challenge });
    const { status, text } = await hit(`/webhook?${query}`);
    return status === 200 && text === challenge
      ? result('ok', 'Webhook: el handshake de Meta devuelve hub.challenge')
      : result('fail', `Webhook: handshake respondió ${status}`, 'WHATSAPP_WEBHOOK_VERIFY_TOKEN de Render debe ser igual al de tu .env y al de Meta.');
  });

  await check('firma', async () => {
    const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
    const unsigned = await hit('/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    results.push(unsigned.status === 403
      ? result('ok', 'Webhook: rechaza un POST sin firma (403)')
      : result('fail', `Webhook: aceptó un POST sin firma (${unsigned.status})`, 'Pon ENFORCE_WHATSAPP_SIGNATURE=true en Render → Environment.'));
    if (!env.WHATSAPP_APP_SECRET) return result('warn', 'POST firmado sin probar: falta WHATSAPP_APP_SECRET en tu .env');
    const signature = `sha256=${crypto.createHmac('sha256', env.WHATSAPP_APP_SECRET).update(body).digest('hex')}`;
    const signed = await hit('/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': signature }, body });
    return signed.status === 200
      ? result('ok', 'Webhook: acepta un POST firmado con WHATSAPP_APP_SECRET')
      : result('fail', `Webhook: rechazó un POST bien firmado (${signed.status})`, 'WHATSAPP_APP_SECRET de Render debe ser la "Clave secreta de la app" (Meta → tu app → Configuración → Básica).');
  });

  await check('jobs', async () => {
    const { status } = await hit('/jobs/reminders', { method: 'POST' });
    return status === 401
      ? result('ok', '/jobs/* sin secreto → 401')
      : result('fail', `/jobs/reminders sin secreto respondió ${status}`, status === 503 ? 'Falta CRON_SECRET en Render.' : 'Los jobs deben exigir x-cron-secret.');
  });

  await check('panel', async () => {
    const { status } = await hit('/api/panel/conversations');
    return status === 401
      ? result('ok', 'Panel sin sesión → 401')
      : result('fail', `Panel sin sesión respondió ${status}`, 'Define PANEL_USER y PANEL_PASSWORD en Render.');
  });

  if (apply) {
    await check('plantilla', async () => {
      if (!env.OWNER_ALERT_PHONE) return result('warn', 'Plantilla sin enviar: falta OWNER_ALERT_PHONE');
      const sent = await sendTestTemplate(env, env.OWNER_ALERT_PHONE, fetchImpl);
      return sent.ok
        ? result('ok', `Plantilla hello_world enviada al dueño (message id …${String(sent.messageId || '').slice(-6)})`)
        : result('fail', `Plantilla de prueba: ${sent.reason}`, sent.expired ? 'TOKEN DE WHATSAPP VENCIDO: docs/go-live.md → token permanente.' : 'Con el número de prueba, OWNER_ALERT_PHONE debe estar en la lista "Para" de Meta.');
    });
  } else {
    results.push(result('info', 'Plantilla de prueba no enviada (agrega --apply para enviarla a OWNER_ALERT_PHONE)'));
  }
  return results;
}

async function main() {
  const env = await loadEnv();
  const { apply, positional } = parseArgs();
  const baseUrl = positional[0] || env.PUBLIC_BASE_URL;
  if (!baseUrl || !/^https?:\/\//.test(baseUrl)) {
    console.error('Uso: npm run smoke:prod -- https://<servicio>.onrender.com [--apply]');
    return 1;
  }
  console.log(`🚦 Smoke test contra ${new URL(baseUrl).host}`);
  const results = await smokeProd(baseUrl, env, { apply });
  printResults('Resultado', results);
  const failed = results.filter((r) => r.status === 'fail').length;
  console.log(failed ? `\n${failed} ❌: corrígelos y vuelve a correr.` : '\nProducción OK 🚀');
  return failed ? 1 : 0;
}

runIfMain(import.meta.url, main);
