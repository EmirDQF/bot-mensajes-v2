// Graph API de Meta (WhatsApp Cloud API) para los scripts de go-live y el preflight.
// Todo recibe fetchImpl (tests con fetch simulado) y nunca devuelve ni imprime el token.
import { result, last4, redact } from './cli.js';
import { TOKEN_STEPS } from '../../services/systemAlerts.js';

export const REQUIRED_SCOPES = ['whatsapp_business_messaging', 'whatsapp_business_management'];

export function createGraph(env, fetchImpl = fetch) {
  const version = env.WHATSAPP_API_VERSION || 'v21.0';
  const base = `https://graph.facebook.com/${version}`;
  async function call(method, pathAndQuery, { body, token = env.WHATSAPP_TOKEN } = {}) {
    const res = await fetchImpl(`${base}/${pathAndQuery}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body: json, error: json?.error || null };
  }
  return {
    get: (p, opts) => call('GET', p, opts),
    post: (p, body, opts) => call('POST', p, { ...opts, body }),
  };
}

const metaReason = (error) => redact(error?.message || 'sin detalle');
const isExpired = (error) => Number(error?.code) === 190;
export const expiredResult = () => result('fail', 'TOKEN DE WHATSAPP VENCIDO (error 190)', TOKEN_STEPS);
export const isExpiredResult = (results) => results.some((r) => /TOKEN DE WHATSAPP VENCIDO/.test(r.label));

// Un 190 al listar (plantillas, apps) se convierte en el mismo ❌ con los pasos; lo demás se relanza.
async function guard(fn) {
  try {
    return await fn();
  } catch (error) {
    if (isExpired(error.meta)) return [expiredResult()];
    throw error;
  }
}

// Tipo de token con /debug_token. Con META_APP_ID se usa el token de la app (id|secreto);
// sin él, el propio token se inspecciona a sí mismo (Meta lo permite).
export async function checkTokenType(env, fetchImpl = fetch) {
  if (!env.WHATSAPP_TOKEN) return [result('fail', 'WHATSAPP_TOKEN no está definida', TOKEN_STEPS)];
  const graph = createGraph(env, fetchImpl);
  const inspector = env.META_APP_ID && env.WHATSAPP_APP_SECRET ? `${env.META_APP_ID}|${env.WHATSAPP_APP_SECRET}` : env.WHATSAPP_TOKEN;
  try {
    const { ok, body, error } = await graph.get(`debug_token?input_token=${encodeURIComponent(env.WHATSAPP_TOKEN)}`, { token: inspector });
    if (!ok) {
      if (isExpired(error)) return [expiredResult()];
      return [result('warn', `No se pudo leer el tipo de token (${metaReason(error)})`, 'Opcional: define META_APP_ID (Meta for Developers → tu app → Configuración → Básica → Identificador de la app).')];
    }
    const data = body.data || {};
    if (data.is_valid === false) return [expiredResult()];
    const results = [];
    const expiresAt = Number(data.expires_at || 0);
    if (expiresAt === 0) {
      results.push(result('ok', `Token PERMANENTE${data.type ? ` (${data.type === 'SYSTEM_USER' ? 'usuario del sistema' : data.type})` : ''}: no vence`));
    } else {
      const hours = Math.max(0, Math.round((expiresAt * 1000 - Date.now()) / 36e5));
      results.push(result('warn', `Token TEMPORAL: vence en ~${hours} h`, TOKEN_STEPS));
    }
    const scopes = Array.isArray(data.scopes) ? data.scopes : [];
    const missing = REQUIRED_SCOPES.filter((s) => !scopes.includes(s));
    if (scopes.length && missing.length) results.push(result('fail', `Al token le faltan permisos: ${missing.join(', ')}`, TOKEN_STEPS));
    return results;
  } catch (error) {
    return [result('fail', 'No se pudo contactar a Meta', `Revisa tu conexión (${redact(error.message)}).`)];
  }
}

// Número: nombre, estado del nombre, calidad, límite de mensajes y si está en Cloud API.
export async function checkPhoneNumber(env, fetchImpl = fetch) {
  if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) return [result('fail', 'Número sin probar', 'Define WHATSAPP_TOKEN y WHATSAPP_PHONE_NUMBER_ID.')];
  const graph = createGraph(env, fetchImpl);
  const fields = 'verified_name,display_phone_number,quality_rating,name_status,code_verification_status,messaging_limit_tier,platform_type,status';
  const { ok, body, error } = await graph.get(`${encodeURIComponent(env.WHATSAPP_PHONE_NUMBER_ID)}?fields=${fields}`);
  if (!ok) {
    if (isExpired(error)) return [expiredResult()];
    if (Number(error?.code) === 100) return [result('fail', `WHATSAPP_PHONE_NUMBER_ID (${last4(env.WHATSAPP_PHONE_NUMBER_ID)}) no existe para este token`, 'Copia el "Identificador del número de teléfono" (no el número) desde Meta for Developers → WhatsApp → Configuración de la API.')];
    return [result('fail', `Meta respondió error: ${metaReason(error)}`)];
  }
  const digits = String(body.display_phone_number || '').replace(/\D/g, '');
  const results = [result('ok', `Número "${body.verified_name || 'sin nombre'}" (${last4(digits)}) · id ${last4(env.WHATSAPP_PHONE_NUMBER_ID)}`)];
  const name = body.name_status || 'sin dato';
  const nameOk = /APPROVED|AVAILABLE_WITHOUT_REVIEW/i.test(name);
  results.push(result(nameOk ? 'ok' : 'warn', `Estado del nombre: ${name}`,
    nameOk ? undefined : 'Meta revisa el nombre visible en 1-3 días (WhatsApp Manager → Números de teléfono). Mientras, el bot funciona.'));
  results.push(result(/RED/i.test(body.quality_rating || '') ? 'fail' : 'ok', `Calidad: ${body.quality_rating || 'sin dato'}`));
  results.push(result('info', `Límite de mensajes: ${body.messaging_limit_tier || 'sin dato (sin verificación del negocio: 250 conversaciones iniciadas por la clínica cada 24 h)'}`));
  const cloud = /CLOUD_API/i.test(body.platform_type || '') || /CONNECTED/i.test(body.status || '');
  results.push(result(cloud ? 'ok' : 'warn', `Registrado en Cloud API: ${cloud ? 'sí' : `no (${body.platform_type || body.status || 'sin dato'})`}`,
    cloud ? undefined : 'Registra el número: POST /{PHONE_NUMBER_ID}/register con un PIN de 6 dígitos (docs/go-live.md).'));
  if (/^test number$/i.test(String(body.verified_name || '').trim())) {
    results.push(result('warn', 'Es el NÚMERO DE PRUEBA de Meta', 'Solo escribe a los 5 destinatarios autorizados (WhatsApp → Configuración de la API → "Para"). Para pacientes reales registra el número de la clínica (docs/go-live.md).'));
  }
  return results;
}

const wabaMissing = () => result('warn', 'WHATSAPP_BUSINESS_ACCOUNT_ID no está definida',
  'Meta for Developers → tu app → WhatsApp → Configuración de la API → "Identificador de la cuenta de WhatsApp Business".');

export async function listSubscribedApps(env, fetchImpl = fetch) {
  const { ok, body, error } = await createGraph(env, fetchImpl).get(`${encodeURIComponent(env.WHATSAPP_BUSINESS_ACCOUNT_ID)}/subscribed_apps`);
  if (!ok) throw Object.assign(new Error(metaReason(error)), { meta: error });
  return (body.data || []).map((a) => a.whatsapp_business_api_data?.name || a.name || a.whatsapp_business_api_data?.id || 'app');
}

export async function listTemplates(env, fetchImpl = fetch) {
  const graph = createGraph(env, fetchImpl);
  const first = `${encodeURIComponent(env.WHATSAPP_BUSINESS_ACCOUNT_ID)}/message_templates?fields=name,status,language,category,rejected_reason&limit=100`;
  const out = [];
  let next = first;
  for (let page = 0; next && page < 10; page += 1) {
    const { ok, body, error } = await graph.get(next);
    if (!ok) throw Object.assign(new Error(metaReason(error)), { meta: error });
    out.push(...(body.data || []));
    const after = body.paging?.cursors?.after;
    next = body.paging?.next && after ? `${first}&after=${encodeURIComponent(after)}` : null;
  }
  return out;
}

const TEMPLATE_STATUS = { APPROVED: 'ok', PENDING: 'warn', IN_APPEAL: 'warn', REJECTED: 'fail', PAUSED: 'warn', DISABLED: 'fail' };

// WABA: el número pertenece, la app está suscrita y el estado de cada plantilla del producto.
export async function checkWaba(env, templates, fetchImpl = fetch) {
  if (!env.WHATSAPP_BUSINESS_ACCOUNT_ID) return [wabaMissing()];
  const results = [];
  try {
    const { ok, body, error } = await createGraph(env, fetchImpl).get(`${encodeURIComponent(env.WHATSAPP_BUSINESS_ACCOUNT_ID)}/phone_numbers?fields=id`);
    if (!ok) {
      if (isExpired(error)) return [expiredResult()];
      return [result('fail', `WABA ${last4(env.WHATSAPP_BUSINESS_ACCOUNT_ID)}: ${metaReason(error)}`, 'Revisa WHATSAPP_BUSINESS_ACCOUNT_ID y que el token tenga whatsapp_business_management sobre esa cuenta.')];
    }
    const ids = (body.data || []).map((p) => String(p.id));
    results.push(ids.includes(String(env.WHATSAPP_PHONE_NUMBER_ID))
      ? result('ok', `El número ${last4(env.WHATSAPP_PHONE_NUMBER_ID)} pertenece al WABA ${last4(env.WHATSAPP_BUSINESS_ACCOUNT_ID)}`)
      : result('fail', `El número ${last4(env.WHATSAPP_PHONE_NUMBER_ID)} NO está en el WABA ${last4(env.WHATSAPP_BUSINESS_ACCOUNT_ID)}`, 'Usa el WABA y el número de la misma pantalla (WhatsApp → Configuración de la API).'));

    const apps = await listSubscribedApps(env, fetchImpl);
    results.push(apps.length
      ? result('ok', `App suscrita al WABA: ${apps.join(', ')}`)
      : result('fail', 'Ninguna app suscrita al WABA: los mensajes no llegarán al webhook', 'npm run meta:subscribe -- --apply'));

    const existing = await listTemplates(env, fetchImpl);
    for (const plan of planTemplates(existing, templates)) {
      if (plan.action === 'create') {
        results.push(result('warn', `Plantilla ${plan.name}: no enviada a aprobación`, 'npm run meta:templates -- --apply'));
      } else {
        const reason = plan.rejectedReason && plan.rejectedReason !== 'NONE' ? ` — ${plan.rejectedReason}` : '';
        results.push(result(TEMPLATE_STATUS[plan.status] || 'warn', `Plantilla ${plan.name} (${plan.language}): ${plan.status}${reason}`,
          plan.status === 'REJECTED' ? 'Corrige el texto en config/whatsappTemplates.js, usa otro nombre (WA_TEMPLATE_*) y vuelve a enviarla.' : undefined));
      }
    }
  } catch (error) {
    if (isExpired(error.meta)) return [expiredResult()];
    results.push(result('fail', `WABA: ${redact(error.message)}`));
  }
  return results;
}

// ---------- Plantillas ----------
export function buildTemplatePayload(tpl, clinic) {
  const example = tpl.example(clinic).map((v) => String(v ?? '').trim() || '-');
  const components = [{ type: 'BODY', text: tpl.body, example: { body_text: [example] } }];
  if (tpl.buttons?.length) components.push({ type: 'BUTTONS', buttons: tpl.buttons.map((text) => ({ type: 'QUICK_REPLY', text })) });
  return { name: tpl.name, language: tpl.language || 'es', category: tpl.category || 'UTILITY', components };
}

// Qué plantilla crear y cuál ya existe (mismo nombre e idioma): idempotente.
export function planTemplates(existing, templates) {
  return Object.entries(templates).filter(([, tpl]) => tpl.body).map(([key, tpl]) => {
    const language = tpl.language || 'es';
    const found = existing.find((t) => t.name === tpl.name && (t.language || 'es') === language);
    return found
      ? { key, name: tpl.name, language: found.language, action: 'exists', status: found.status, rejectedReason: found.rejected_reason }
      : { key, name: tpl.name, language, action: 'create' };
  });
}

export function submitTemplates(env, templates, clinic, options = {}) {
  return guard(() => submitTemplatesUnsafe(env, templates, clinic, options));
}

async function submitTemplatesUnsafe(env, templates, clinic, { apply = false, fetchImpl = fetch } = {}) {
  if (!env.WHATSAPP_BUSINESS_ACCOUNT_ID) return [wabaMissing()];
  const existing = await listTemplates(env, fetchImpl);
  const graph = createGraph(env, fetchImpl);
  const results = [];
  for (const plan of planTemplates(existing, templates)) {
    if (plan.action === 'exists') {
      results.push(result('skip', `${plan.name} (${plan.language}) ya existe: ${plan.status}`));
      continue;
    }
    const payload = buildTemplatePayload(templates[plan.key], clinic);
    if (!apply) {
      results.push(result('info', `${plan.name} (${payload.language}, ${payload.category}) se enviaría a aprobación`));
      continue;
    }
    const { ok, body, error } = await graph.post(`${encodeURIComponent(env.WHATSAPP_BUSINESS_ACCOUNT_ID)}/message_templates`, payload);
    results.push(ok
      ? result('ok', `${plan.name} enviada: ${body.status || 'PENDING'} (id ${last4(body.id)})`)
      : result('fail', `${plan.name}: ${metaReason(error)}`, error?.error_user_msg ? redact(error.error_user_msg) : undefined));
  }
  return results;
}

// ---------- Suscripción de la app al WABA ----------
export function subscribeApp(env, options = {}) {
  return guard(() => subscribeAppUnsafe(env, options));
}

async function subscribeAppUnsafe(env, { apply = false, fetchImpl = fetch } = {}) {
  if (!env.WHATSAPP_BUSINESS_ACCOUNT_ID) return [wabaMissing()];
  const apps = await listSubscribedApps(env, fetchImpl);
  if (apps.length) return [result('skip', `Ya suscrita: ${apps.join(', ')}. No hay nada que hacer.`)];
  if (!apply) return [result('info', `Se suscribiría la app al WABA ${last4(env.WHATSAPP_BUSINESS_ACCOUNT_ID)} (usa --apply)`)];
  const { ok, body, error } = await createGraph(env, fetchImpl).post(`${encodeURIComponent(env.WHATSAPP_BUSINESS_ACCOUNT_ID)}/subscribed_apps`, {});
  return [ok && body.success !== false
    ? result('ok', `App suscrita al WABA ${last4(env.WHATSAPP_BUSINESS_ACCOUNT_ID)}`)
    : result('fail', `No se pudo suscribir: ${metaReason(error)}`, 'El token necesita whatsapp_business_management sobre esta cuenta (docs/go-live.md).')];
}

// Plantilla de prueba (hello_world existe en todo WABA) para smoke:prod.
export async function sendTestTemplate(env, to, fetchImpl = fetch) {
  const { ok, body, error } = await createGraph(env, fetchImpl).post(`${encodeURIComponent(env.WHATSAPP_PHONE_NUMBER_ID)}/messages`, {
    messaging_product: 'whatsapp', to, type: 'template', template: { name: 'hello_world', language: { code: 'en_US' } },
  });
  if (!ok) return { ok: false, reason: metaReason(error), expired: isExpired(error) };
  return { ok: true, messageId: body.messages?.[0]?.id || null };
}
