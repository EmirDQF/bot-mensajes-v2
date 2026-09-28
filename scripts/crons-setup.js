// npm run crons:setup — crea o actualiza en cron-job.org las 6 tareas del bot (idempotente: se reconocen
// por el título "<clinica> · <tarea>"). --dry-run por defecto; --apply para ejecutar.
// Sin CRONJOB_API_KEY imprime la tabla para crearlas a mano. Nunca imprime CRON_SECRET ni la clave.
// API: https://docs.cron-job.org/rest-api.html (requestMethod 0 = GET, 1 = POST; -1 = "todos").
import { loadEnv, parseArgs, printResults, result, runIfMain, redact } from './lib/cli.js';

const API = 'https://api.cron-job.org';
const ALL = [-1];
const every = (step) => Array.from({ length: 60 / step }, (_, i) => i * step);

// Horas en UTC: 13:00 UTC = 8:00 a. m. de Lima.
export const CRON_JOBS = [
  { key: 'health', method: 'GET', path: '/health', secret: false, when: 'Cada 10 minutos', schedule: { minutes: every(10), hours: ALL, wdays: ALL } },
  { key: 'reminders', method: 'POST', path: '/jobs/reminders', secret: true, when: 'Cada 15 minutos', schedule: { minutes: every(15), hours: ALL, wdays: ALL } },
  { key: 'follow-ups', method: 'POST', path: '/jobs/follow-ups', secret: true, when: 'Cada hora (minuto 0)', schedule: { minutes: [0], hours: ALL, wdays: ALL } },
  { key: 'daily-summary', method: 'POST', path: '/jobs/daily-summary', secret: true, when: 'Todos los días 13:00 UTC (8:00 Lima)', schedule: { minutes: [0], hours: [13], wdays: ALL } },
  { key: 'weekly-report', method: 'POST', path: '/jobs/weekly-report', secret: true, when: 'Lunes 13:00 UTC (8:00 Lima)', schedule: { minutes: [0], hours: [13], wdays: [1] } },
  { key: 'health-deep', method: 'GET', path: '/health/deep', secret: true, when: 'Cada 12 horas', schedule: { minutes: [5], hours: [0, 12], wdays: ALL } },
];

export const jobTitle = (clinicId, job) => `${clinicId} · ${job.key}`;

export function buildJob(job, { baseUrl, cronSecret, clinicId }) {
  return {
    title: jobTitle(clinicId, job),
    url: `${baseUrl.replace(/\/+$/, '')}${job.path}`,
    enabled: true,
    saveResponses: true,
    requestTimeout: 30,
    requestMethod: job.method === 'POST' ? 1 : 0,
    schedule: { timezone: 'UTC', expiresAt: 0, mdays: ALL, months: ALL, ...job.schedule },
    extendedData: { headers: job.secret ? { 'x-cron-secret': cronSecret } : {}, body: '' },
  };
}

export function manualTable(baseUrl) {
  const url = (baseUrl || 'TU-URL').replace(/\/+$/, '');
  const rows = CRON_JOBS.map((j, i) => `| ${i + 1} | ${j.method} | ${url}${j.path} | ${j.secret ? 'x-cron-secret: <CRON_SECRET>' : '—'} | ${j.when} |`);
  return ['| # | Método | URL | Header | Frecuencia |', '|---|---|---|---|---|', ...rows].join('\n');
}

export async function setupCrons(env, { apply = false, clinicId, fetchImpl = fetch, delayMs = 1100 } = {}) {
  const baseUrl = env.PUBLIC_BASE_URL || env.RENDER_EXTERNAL_URL;
  if (!baseUrl || /localhost|127\.0\.0\.1/.test(baseUrl)) return [result('fail', 'PUBLIC_BASE_URL no está definida (o apunta a localhost)', 'Pon la URL de Render (https://<servicio>.onrender.com) en PUBLIC_BASE_URL.')];
  if (!env.CRON_SECRET) return [result('fail', 'CRON_SECRET no está definida', 'Genera uno: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"')];
  const headers = { Authorization: `Bearer ${env.CRONJOB_API_KEY}`, 'Content-Type': 'application/json' };
  const call = async (method, path, body) => {
    const res = await fetchImpl(`${API}${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(res.status === 401 ? 'cron-job.org rechazó CRONJOB_API_KEY (401)' : `cron-job.org respondió ${res.status}`);
    return json;
  };
  const wait = () => (delayMs ? new Promise((r) => setTimeout(r, delayMs)) : null);

  const { jobs = [] } = await call('GET', '/jobs');
  const results = [];
  for (const job of CRON_JOBS) {
    const wanted = buildJob(job, { baseUrl, cronSecret: env.CRON_SECRET, clinicId });
    const existing = jobs.find((j) => j.title === wanted.title);
    const label = `${job.method} ${job.path} — ${job.when}`;
    if (!apply) {
      results.push(result('info', `${existing ? 'Se actualizaría' : 'Se crearía'}: ${label}`));
      continue;
    }
    try {
      if (existing) await call('PATCH', `/jobs/${existing.jobId}`, { job: wanted });
      else await call('PUT', '/jobs', { job: wanted });
      results.push(result('ok', `${existing ? 'Actualizada' : 'Creada'}: ${label}`));
    } catch (error) {
      results.push(result('fail', `${label}: ${redact(error.message)}`));
    }
    await wait(); // la API de cron-job.org limita las escrituras por segundo
  }
  return results;
}

async function main() {
  const env = await loadEnv();
  const { apply } = parseArgs();
  const { default: clinic } = await import('../config/clinic.config.js');
  if (!env.CRONJOB_API_KEY) {
    console.log('Sin CRONJOB_API_KEY: crea estas 6 tareas a mano en https://cron-job.org → Create cronjob');
    console.log('(o crea la clave en cron-job.org → Settings → API y vuelve a correr npm run crons:setup -- --apply)\n');
    console.log(manualTable(env.PUBLIC_BASE_URL || env.RENDER_EXTERNAL_URL));
    return 0;
  }
  console.log(`⏰ cron-job.org: tareas de ${clinic.id}${apply ? '' : ' — DRY RUN (agrega --apply para ejecutarlo)'}`);
  const results = await setupCrons(env, { apply, clinicId: clinic.id });
  printResults('Tareas', results);
  if (apply) console.log('\nEn cron-job.org abre cada tarea → "Test run": debe responder 200.');
  return results.some((r) => r.status === 'fail') ? 1 : 0;
}

runIfMain(import.meta.url, main);
