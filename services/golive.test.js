import { describe, it } from 'node:test';
import assert from 'assert';
import crypto from 'crypto';
import { redact, parseArgs } from '../scripts/lib/cli.js';
import {
  checkTokenType, checkPhoneNumber, checkWaba, buildTemplatePayload, planTemplates, submitTemplates, subscribeApp,
} from '../scripts/lib/meta.js';
import { applyMigrations, planMigrations } from '../scripts/db.js';
import { setupCrons, buildJob, CRON_JOBS, manualTable } from '../scripts/crons-setup.js';
import { smokeProd } from '../scripts/smoke-prod.js';
import { TEMPLATES } from '../config/whatsappTemplates.js';
import clinic from '../config/clinic.config.js';

const TOKEN = 'EAAG-token-secreto-de-prueba-123456';
const ENV = { WHATSAPP_TOKEN: TOKEN, WHATSAPP_PHONE_NUMBER_ID: '1111222233334444', WHATSAPP_BUSINESS_ACCOUNT_ID: '9999888877776666' };
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });

// Router de fetch simulado: [método, regex de la URL, respuesta]. Guarda cada llamada.
function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, init = {}) => {
    const method = init.method || 'GET';
    calls.push({ url, method, headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : null });
    const route = routes.find(([m, re]) => m === method && re.test(url));
    if (!route) throw new Error(`ruta no simulada: ${method} ${url}`);
    return typeof route[2] === 'function' ? route[2](url, init) : route[2];
  };
  impl.calls = calls;
  return impl;
}

const allText = (results) => results.map((r) => `${r.label} ${r.fix || ''}`).join('\n');

describe('go-live: utilidades sin secretos', () => {
  it('redact oculta secretos del entorno, tokens en URLs y cadenas de conexión', () => {
    const out = redact(`t=${TOKEN} x?access_token=abc123 Bearer abc.def postgres://u:p@h/db`, { WHATSAPP_TOKEN: TOKEN });
    assert.ok(!out.includes(TOKEN) && !out.includes('abc123') && !out.includes('u:p@h'));
  });

  it('--dry-run es el defecto', () => {
    assert.equal(parseArgs([]).apply, false);
    assert.equal(parseArgs(['templates', '--apply']).apply, true);
    assert.deepEqual(parseArgs(['templates', '--apply']).positional, ['templates']);
  });
});

describe('go-live: meta:check', () => {
  it('distingue token permanente, temporal y vencido (190) con debug_token', async () => {
    const permanent = await checkTokenType(ENV, fakeFetch([['GET', /debug_token/, json(200, { data: { is_valid: true, type: 'SYSTEM_USER', expires_at: 0, scopes: ['whatsapp_business_messaging', 'whatsapp_business_management'] } })]]));
    assert.equal(permanent[0].status, 'ok');
    assert.match(permanent[0].label, /PERMANENTE/);

    const soon = Math.floor(Date.now() / 1000) + 20 * 3600;
    const temporary = await checkTokenType(ENV, fakeFetch([['GET', /debug_token/, json(200, { data: { is_valid: true, type: 'USER', expires_at: soon, scopes: ['whatsapp_business_messaging'] } })]]));
    assert.equal(temporary[0].status, 'warn');
    assert.match(temporary[0].label, /TEMPORAL/);
    assert.equal(temporary[1].status, 'fail');
    assert.match(temporary[1].label, /whatsapp_business_management/);

    const expired = await checkTokenType(ENV, fakeFetch([['GET', /debug_token/, json(400, { error: { code: 190, message: `token ${TOKEN} expired` } })]]));
    assert.match(expired[0].label, /TOKEN DE WHATSAPP VENCIDO/);
    assert.ok(!allText([...permanent, ...temporary, ...expired]).includes(TOKEN));
  });

  it('usa el token de la app (id|secreto) si hay META_APP_ID', async () => {
    const fetchImpl = fakeFetch([['GET', /debug_token/, json(200, { data: { is_valid: true, expires_at: 0 } })]]);
    await checkTokenType({ ...ENV, META_APP_ID: '123', WHATSAPP_APP_SECRET: 'app-secret-xyz' }, fetchImpl);
    assert.equal(fetchImpl.calls[0].headers.Authorization, 'Bearer 123|app-secret-xyz');
  });

  it('resume el número: nombre, calidad, límite y Cloud API, con solo los últimos 4 dígitos', async () => {
    const results = await checkPhoneNumber(ENV, fakeFetch([['GET', /1111222233334444\?fields=/, json(200, {
      verified_name: 'Clínica', display_phone_number: '+51 912 345 678', quality_rating: 'GREEN', name_status: 'APPROVED', messaging_limit_tier: 'TIER_1K', platform_type: 'CLOUD_API',
    })]]));
    const text = allText(results);
    assert.ok(results.every((r) => r.status !== 'fail'));
    assert.match(text, /…5678/);
    assert.ok(!text.includes('912 345') && !text.includes('1111222233334444'));
    assert.match(text, /TIER_1K/);
  });

  it('WABA: número propio, app suscrita y estado de cada plantilla', async () => {
    const results = await checkWaba(ENV, TEMPLATES, fakeFetch([
      ['GET', /phone_numbers/, json(200, { data: [{ id: '1111222233334444' }] })],
      ['GET', /subscribed_apps/, json(200, { data: [] })],
      ['GET', /message_templates/, json(200, { data: [{ name: TEMPLATES.reminder24h.name, language: 'es', status: 'APPROVED' }, { name: TEMPLATES.review.name, language: 'es', status: 'REJECTED', rejected_reason: 'PROMOTIONAL' }] })],
    ]));
    const find = (re) => results.find((r) => re.test(r.label));
    assert.equal(find(/pertenece/).status, 'ok');
    assert.equal(find(/Ninguna app suscrita/).status, 'fail');
    assert.match(find(/Ninguna app/).fix, /meta:subscribe/);
    assert.equal(find(new RegExp(TEMPLATES.reminder24h.name)).status, 'ok');
    assert.equal(find(new RegExp(TEMPLATES.review.name)).status, 'fail');
    assert.equal(find(new RegExp(TEMPLATES.reminder2h.name)).status, 'warn');
  });

  it('sin WHATSAPP_BUSINESS_ACCOUNT_ID dice dónde encontrarlo', async () => {
    const [r] = await checkWaba({ WHATSAPP_TOKEN: TOKEN }, TEMPLATES, fakeFetch([]));
    assert.equal(r.status, 'warn');
    assert.match(r.fix, /Identificador de la cuenta de WhatsApp Business/);
  });
});

describe('go-live: meta:templates y meta:subscribe', () => {
  it('arma cada plantilla en español con ejemplos de la clínica activa y la cantidad justa de variables', () => {
    for (const tpl of Object.values(TEMPLATES)) {
      const payload = buildTemplatePayload(tpl, clinic);
      assert.equal(payload.language, 'es');
      assert.ok(['UTILITY', 'MARKETING'].includes(payload.category));
      const body = payload.components[0];
      const vars = body.text.match(/\{\{\d+\}\}/g).length;
      assert.equal(body.example.body_text[0].length, vars, tpl.name);
      assert.ok(body.example.body_text[0].every((v) => v.trim()), tpl.name);
      assert.ok(!/^\s*\{\{|\}\}\s*$/.test(body.text), `${tpl.name}: Meta rechaza variables al inicio o al final`);
    }
    assert.equal(buildTemplatePayload(TEMPLATES.reactivation, clinic).category, 'MARKETING');
    assert.equal(buildTemplatePayload(TEMPLATES.reminder24h, clinic).components[1].buttons[0].type, 'QUICK_REPLY');
  });

  it('salta las existentes, no envía nada en dry-run y envía solo las que faltan con --apply', async () => {
    const existing = [{ name: TEMPLATES.reminder24h.name, language: 'es', status: 'APPROVED' }];
    assert.equal(planTemplates(existing, TEMPLATES).filter((p) => p.action === 'create').length, Object.keys(TEMPLATES).length - 1);

    const routes = () => [
      ['GET', /message_templates/, json(200, { data: existing })],
      ['POST', /message_templates/, json(200, { id: '55512345', status: 'PENDING' })],
    ];
    const dry = fakeFetch(routes());
    const dryResults = await submitTemplates(ENV, TEMPLATES, clinic, { fetchImpl: dry });
    assert.equal(dry.calls.filter((c) => c.method === 'POST').length, 0);
    assert.equal(dryResults.filter((r) => r.status === 'skip').length, 1);

    const live = fakeFetch(routes());
    const liveResults = await submitTemplates(ENV, TEMPLATES, clinic, { apply: true, fetchImpl: live });
    const posts = live.calls.filter((c) => c.method === 'POST');
    assert.equal(posts.length, Object.keys(TEMPLATES).length - 1);
    assert.ok(!posts.some((p) => p.body.name === TEMPLATES.reminder24h.name));
    assert.ok(liveResults.filter((r) => r.status === 'ok').every((r) => /PENDING/.test(r.label)));
  });

  it('suscribe la app solo con --apply y no repite si ya está suscrita', async () => {
    const empty = () => [['GET', /subscribed_apps/, json(200, { data: [] })], ['POST', /subscribed_apps/, json(200, { success: true })]];
    const dry = fakeFetch(empty());
    assert.equal((await subscribeApp(ENV, { fetchImpl: dry }))[0].status, 'info');
    assert.equal(dry.calls.some((c) => c.method === 'POST'), false);

    const live = fakeFetch(empty());
    assert.equal((await subscribeApp(ENV, { apply: true, fetchImpl: live }))[0].status, 'ok');

    const already = fakeFetch([['GET', /subscribed_apps/, json(200, { data: [{ whatsapp_business_api_data: { name: 'Mi app' } }] })]]);
    const [r] = await subscribeApp(ENV, { apply: true, fetchImpl: already });
    assert.equal(r.status, 'skip');
    assert.equal(already.calls.length, 1);
  });
});

describe('go-live: db:migrate', () => {
  function fakePg({ applied = [], exists = true, failOn = null } = {}) {
    const queries = [];
    return {
      queries,
      async query(sql) {
        queries.push(sql);
        if (/to_regclass/.test(sql)) return { rows: [{ name: exists ? 'schema_migrations' : null }] };
        if (/SELECT filename/.test(sql)) return { rows: applied.map((filename) => ({ filename })) };
        if (failOn && sql === failOn) throw new Error('syntax error');
        return { rows: [] };
      },
    };
  }
  const files = [{ name: '001.sql', sql: 'SELECT 1' }, { name: '002.sql', sql: 'SELECT 2' }, { name: '003.sql', sql: 'SELECT 3' }];

  it('planifica solo las que faltan', () => {
    assert.deepEqual(planMigrations(files, ['001.sql']).map((f) => f.name), ['002.sql', '003.sql']);
  });

  it('dry-run no crea ni aplica nada', async () => {
    const pg = fakePg({ exists: false });
    const results = await applyMigrations(pg, files);
    assert.equal(results.length, 3);
    assert.ok(!pg.queries.some((q) => /CREATE TABLE|BEGIN|^SELECT [123]$/.test(q)));
  });

  it('--apply aplica en orden, cada una en su transacción, y recarga la caché de la API', async () => {
    const pg = fakePg({ applied: ['001.sql'] });
    const results = await applyMigrations(pg, files, { apply: true });
    assert.deepEqual(results.map((r) => r.status), ['ok', 'ok']);
    assert.ok(pg.queries.indexOf('SELECT 2') < pg.queries.indexOf('SELECT 3'));
    assert.ok(!pg.queries.includes('SELECT 1'));
    assert.match(pg.queries.at(-1), /NOTIFY pgrst/);
  });

  it('si una falla hace ROLLBACK y se detiene', async () => {
    const pg = fakePg({ failOn: 'SELECT 2' });
    const results = await applyMigrations(pg, files, { apply: true });
    assert.deepEqual(results.map((r) => r.status), ['ok', 'fail']);
    assert.ok(pg.queries.includes('ROLLBACK'));
    assert.ok(!pg.queries.includes('SELECT 3'));
  });
});

describe('go-live: crons:setup', () => {
  const env = { PUBLIC_BASE_URL: 'https://bot.onrender.com/', CRON_SECRET: 'cron-secret-largo-0123456789abcdef', CRONJOB_API_KEY: 'cronjob-key-123' };

  it('las 6 tareas con su horario (13:00 UTC = 8:00 Lima) y el header solo donde hace falta', () => {
    assert.equal(CRON_JOBS.length, 6);
    const opts = { baseUrl: env.PUBLIC_BASE_URL, cronSecret: env.CRON_SECRET, clinicId: 'demo' };
    const weekly = buildJob(CRON_JOBS.find((j) => j.key === 'weekly-report'), opts);
    assert.equal(weekly.url, 'https://bot.onrender.com/jobs/weekly-report');
    assert.equal(weekly.requestMethod, 1);
    assert.deepEqual([weekly.schedule.hours, weekly.schedule.wdays, weekly.schedule.timezone], [[13], [1], 'UTC']);
    const health = buildJob(CRON_JOBS[0], opts);
    assert.deepEqual(health.extendedData.headers, {});
    assert.deepEqual(health.schedule.minutes, [0, 10, 20, 30, 40, 50]);
    assert.ok(!manualTable(env.PUBLIC_BASE_URL).includes(env.CRON_SECRET));
  });

  it('es idempotente: crea las nuevas, actualiza las existentes por título y no escribe en dry-run', async () => {
    const routes = () => [
      ['GET', /\/jobs$/, json(200, { jobs: [{ jobId: 77, title: 'demo · health' }] })],
      ['PUT', /\/jobs$/, json(200, { jobId: 1 })],
      ['PATCH', /\/jobs\/77$/, json(200, {})],
    ];
    const dry = fakeFetch(routes());
    await setupCrons(env, { clinicId: 'demo', fetchImpl: dry, delayMs: 0 });
    assert.equal(dry.calls.length, 1);

    const live = fakeFetch(routes());
    const results = await setupCrons(env, { apply: true, clinicId: 'demo', fetchImpl: live, delayMs: 0 });
    assert.equal(live.calls.filter((c) => c.method === 'PATCH').length, 1);
    assert.equal(live.calls.filter((c) => c.method === 'PUT').length, 5);
    assert.ok(results.every((r) => r.status === 'ok'));
    assert.equal(live.calls[0].headers.Authorization, 'Bearer cronjob-key-123');
    assert.ok(!allText(results).includes(env.CRON_SECRET));
  });

  it('sin PUBLIC_BASE_URL no toca cron-job.org', async () => {
    const fetchImpl = fakeFetch([]);
    const [r] = await setupCrons({ ...env, PUBLIC_BASE_URL: '' }, { apply: true, clinicId: 'demo', fetchImpl });
    assert.equal(r.status, 'fail');
    assert.equal(fetchImpl.calls.length, 0);
  });
});

describe('go-live: smoke:prod', () => {
  const env = { CRON_SECRET: 'cron-secret-largo-0123456789abcdef', WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'verify-frase', WHATSAPP_APP_SECRET: 'app-secret-xyz', ...ENV, OWNER_ALERT_PHONE: '51912345678' };
  const text = (status, body = '') => ({ ok: status < 400, status, text: async () => body, json: async () => ({}) });
  const rawFetch = (routes) => {
    const inner = fakeFetch(routes);
    // El body del webhook es texto firmado: no se parsea como JSON en el registro.
    const impl = (url, init = {}) => inner(url, { ...init, body: init.body && /graph\.facebook/.test(url) ? init.body : undefined, rawBody: init.body });
    impl.calls = inner.calls;
    return impl;
  };

  // Producción sana, simulada: valida el secreto, el verify token y la firma de verdad.
  function healthyProd() {
    return rawFetch([
      ['GET', /\/health$/, text(200, '{"status":"ok"}')],
      ['GET', /\/health\/deep$/, (url, init) => text(init.headers?.['x-cron-secret'] === env.CRON_SECRET ? 200 : 401)],
      ['GET', /\/webhook\?/, (url) => {
        const q = new URL(url).searchParams;
        return q.get('hub.verify_token') === env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ? text(200, q.get('hub.challenge')) : text(403);
      }],
      ['POST', /\/webhook$/, (url, init) => {
        const expected = `sha256=${crypto.createHmac('sha256', env.WHATSAPP_APP_SECRET).update(init.rawBody).digest('hex')}`;
        return text(init.headers['X-Hub-Signature-256'] === expected ? 200 : 403);
      }],
      ['POST', /\/jobs\/reminders$/, text(401)],
      ['GET', /\/api\/panel\/conversations$/, text(401)],
      ['POST', /graph\.facebook\.com.*\/messages$/, json(200, { messages: [{ id: 'wamid.HBgLNTE5MTIzNDU2NzgVAgARGBI' }] })],
    ]);
  }

  it('todo en ✅ contra un servidor sano, y la plantilla solo se envía con --apply', async () => {
    let t = 0;
    const clock = () => (t += 100);
    const dry = healthyProd();
    const results = await smokeProd('https://bot.onrender.com/', env, { fetchImpl: dry, clock });
    assert.deepEqual(results.filter((r) => r.status !== 'ok').map((r) => r.status), ['info']);
    assert.ok(!dry.calls.some((c) => /graph\.facebook/.test(c.url)));

    const live = healthyProd();
    const applied = await smokeProd('https://bot.onrender.com', env, { fetchImpl: live, apply: true, clock });
    assert.ok(applied.every((r) => r.status === 'ok'), allText(applied));
    assert.match(applied.at(-1).label, /message id/);
    assert.ok(!allText(applied).includes(TOKEN) && !allText(applied).includes(env.CRON_SECRET));
  });

  it('detecta un webhook sin firma obligatoria, jobs abiertos y /health lento', async () => {
    let t = 0;
    const clock = () => (t += 1500);
    const results = await smokeProd('https://bot.onrender.com', env, { clock, fetchImpl: rawFetch([
      ['GET', /\/health$/, text(200)],
      ['GET', /\/health\/deep$/, text(200)],
      ['GET', /\/webhook\?/, (url) => text(200, new URL(url).searchParams.get('hub.challenge'))],
      ['POST', /\/webhook$/, text(200)],
      ['POST', /\/jobs\/reminders$/, text(200)],
      ['GET', /\/api\/panel\/conversations$/, text(401)],
    ]) });
    const find = (re) => results.find((r) => re.test(r.label));
    assert.equal(find(/\/health 200/).status, 'warn');
    assert.equal(find(/sin firma/).status, 'fail');
    assert.match(find(/sin firma/).fix, /ENFORCE_WHATSAPP_SIGNATURE=true/);
    assert.equal(find(/jobs\/reminders/).status, 'fail');
  });
});
