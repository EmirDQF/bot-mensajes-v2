// npm run simulate — conversaciones REALES contra Gemini, con WhatsApp y Supabase falsos.
// Nada sale a Meta ni a la base de datos real: el script fija URLs y tokens ficticios antes de cargar el bot,
// intercepta las llamadas a graph.facebook.com y reemplaza @supabase/supabase-js por una base en memoria.
// Imprime cada chat y guarda docs/qa-report.md con un veredicto por escenario.
//
// Opciones (variables de entorno):
//   MAX_GEMINI_CALLS=30   tope de llamadas a Gemini por corrida (por defecto 30)
//   ONLY=1,7,16           correr solo esos escenarios (no sobrescribe el reporte)
import { mock } from 'node:test';
import fs from 'fs';
import path from 'path';

// ---------- 1. Entorno aislado (antes de cargar cualquier módulo del bot) ----------
// Asignar la variable (aunque sea vacía) impide que src/envLoader.js la tome del .env real.
Object.assign(process.env, {
  NODE_ENV: 'simulation',
  SUPABASE_URL: 'https://supabase-simulado.invalid',
  SUPABASE_SERVICE_ROLE_KEY: 'simulado',
  WHATSAPP_TOKEN: 'simulado',
  WHATSAPP_PHONE_NUMBER_ID: 'simulado',
  WHATSAPP_APP_SECRET: '',
  CLINIC_PHONE: '',
  // Números ficticios de simulación (no existen): solo sirven para ver a quién iría cada alerta.
  RECEPTION_ALERT_PHONE: '000000001',
  OWNER_ALERT_PHONE: '000000002',
  WHATSAPP_MAX_RETRIES: '0',
});

const ROOT = process.cwd();
const MAX_GEMINI_CALLS = Number(process.env.MAX_GEMINI_CALLS || 30);
const ONLY = String(process.env.ONLY || '').split(',').map((v) => Number(v.trim())).filter(Boolean);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------- 2. Supabase en memoria ----------
const { fakeDb } = await import('../services/testing/fakeSupabase.js');
const { now: clockNow, setClock } = await import('../services/clock.js');

// Tablas que el flujo solo escribe o consulta de paso: responden vacío.
const NULL_TABLES = new Set(['leads', 'chat_sessions', 'clinics', 'whatsapp_media_sends']);
const TERMINALS = new Set(['then', 'single', 'maybeSingle']);

function nullBuilder() {
  const empty = { data: null, error: null };
  const proxy = new Proxy({}, {
    get(_, prop) {
      if (prop === 'then') return (resolve, reject) => Promise.resolve(empty).then(resolve, reject);
      if (prop === 'single' || prop === 'maybeSingle') return async () => empty;
      return () => proxy;
    },
  });
  return proxy;
}

function createSimDb() {
  const db = fakeDb({}, { uniqueOn: { follow_ups: ['clinic_id', 'phone'] } });
  let ids = 0;
  const from = db.from.bind(db);
  db.from = (table) => {
    if (NULL_TABLES.has(table)) return nullBuilder();
    const builder = from(table);
    const insert = builder.insert;
    const upsert = builder.upsert;
    builder.insert = (payload) => insert([payload].flat().map((row) => ({
      id: row.id ?? `${table}-${++ids}`, created_at: row.created_at ?? clockNow().toISOString(), ...row,
    })));
    builder.upsert = (payload, opts) => upsert(Array.isArray(payload) ? payload[0] : payload, opts);
    // Métodos que el fake no implementa (or, ilike, delete…) se ignoran y la cadena sigue.
    const proxy = new Proxy(builder, {
      get(target, prop) {
        const value = target[prop];
        if (typeof value !== 'function') return value === undefined ? () => proxy : value;
        if (TERMINALS.has(prop)) return value.bind(target);
        return (...args) => { value.apply(target, args); return proxy; };
      },
    });
    return proxy;
  };
  return db;
}

const db = createSimDb();
mock.module('@supabase/supabase-js', { namedExports: { createClient: () => db } });

// ---------- 3. WhatsApp falso (intercepta graph.facebook.com) ----------
const outbox = [];
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, init = {}) => {
  const url = String(input?.url || input);
  if (url.includes('graph.facebook.com')) {
    const body = init.body ? JSON.parse(init.body) : {};
    if (body.to) {
      outbox.push({
        to: String(body.to), type: body.type || 'text', template: body.template?.name || null,
        text: body.text?.body || body.image?.caption || '', image: body.image?.link || null,
      });
    }
    return new Response(JSON.stringify({ messages: [{ id: `wamid.sim.${outbox.length}` }] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  }
  if (url.includes('supabase-simulado.invalid')) throw new Error('Supabase real bloqueado en la simulación');
  return realFetch(input, init);
};

// ---------- 4. Carga del bot ----------
await import('../src/envLoader.js');
if (!process.env.GEMINI_API_KEY) {
  console.error('❌ Falta GEMINI_API_KEY en .env: la simulación usa Gemini de verdad.');
  process.exit(1);
}
const { getGeminiClient } = await import('../src/geminiClient.js');
const { default: webhookController, waitForIdle } = await import('../controllers/webhookController.js');
const { default: leadService } = await import('../services/leadService.js');
const { default: clinic, getReceptionPhone } = await import('../config/clinic.config.js');

// Los leads no se guardan en la simulación (la tabla responde vacío).
leadService.saveLead = async () => ({ lead: null, readyToNotify: false });

let geminiCalls = 0;
let forceGeminiDown = false;
const model = getGeminiClient();
const generate = model.generateContent.bind(model);
model.generateContent = async (...args) => {
  if (forceGeminiDown) throw new Error('Gemini caído (simulado)');
  geminiCalls += 1;
  if (geminiCalls > MAX_GEMINI_CALLS) throw new Error(`Tope de ${MAX_GEMINI_CALLS} llamadas a Gemini alcanzado`);
  return generate(...args);
};

// Antes de gastar llamadas: ¿la clave funciona? (countTokens no genera texto).
let geminiBlocked = null;
try {
  await model.countTokens('hola');
} catch (error) {
  const reason = error?.errorDetails?.[0]?.reason || error?.status || error?.message;
  geminiBlocked = `Gemini rechazó GEMINI_API_KEY (${reason}). Usa una clave de Google AI Studio (empieza con "AIza") y vuelve a correr npm run simulate.`;
  console.error(`\n❌ ${geminiBlocked}\n   Solo se correrán los escenarios que no usan Gemini.\n`);
}

// ---------- 5. Reloj simulado ----------
// Jueves 1 de octubre de 2026 (Lima, UTC-5).
const NIGHT = Date.parse('2026-10-02T03:30:00Z'); // 10:30 p. m., clínica cerrada
const DAY = Date.parse('2026-10-01T15:00:00Z'); // 10:00 a. m., clínica abierta
function useTime(base) {
  const start = Date.now();
  setClock(() => new Date(base + (Date.now() - start)));
}

// ---------- 6. Conversación ----------
const RECEPTION = getReceptionPhone();
let inboundSeq = 0;

async function send(phone, message) {
  inboundSeq += 1;
  const payload = {
    entry: [{
      changes: [{
        value: {
          metadata: { phone_number_id: 'simulado' },
          contacts: [{ profile: { name: 'Paciente de prueba' } }],
          messages: [{ from: phone, id: `wamid.in.${inboundSeq}`, timestamp: String(Math.floor(clockNow() / 1000)), ...message }],
        },
      }],
    }],
  };
  const res = { status() { return this; }, send() { return this; }, sendStatus() { return this; } };
  await webhookController({ body: payload }, res, () => {});
  await sleep(50);
  await waitForIdle(phone);
}

const text = (body) => ({ type: 'text', text: { body } });

// ---------- 7. Reglas que valen para todos los escenarios ----------
const allowedPrices = new Set();
const collectNumbers = (value) => String(value || '').replace(/(\d)[.,](\d{3})/g, '$1$2').match(/\d+/g) || [];
for (const t of clinic.treatments) {
  allowedPrices.add(String(t.priceFrom));
  collectNumbers(t.financing).forEach((n) => allowedPrices.add(n));
}
collectNumbers(JSON.stringify(clinic.campaign)).forEach((n) => allowedPrices.add(n));
collectNumbers(JSON.stringify(clinic.faq)).forEach((n) => allowedPrices.add(n));

const PROMISES_LOCK = /\b(?:cita|horario|turno)\s+(?:ya\s+)?(?:est[aá]|qued[oó]|queda)\s+(?:agendad|confirmad|bloquead|reservad|separad)\w*|\bagend\w*\s+directo|\bte\s+(?:bloqueo|reservo|separo)\s+el\s+horario/i;
const PRETENDS_HUMAN = /\bsoy\s+(?:una\s+)?(?:persona|humana)\b|\bno\s+soy\s+(?:un\s+)?(?:bot|robot|asistente virtual)\b/i;
const MEDICATION = /\b(?:ibuprofeno|paracetamol|amoxicilina|naproxeno|ketorolaco|diclofenaco|clindamicina|metronidazol|nimesulida|dexametasona)\b|\b\d+\s*mg\b/i;

function check(name, ok, detail = '') {
  return { name, ok: Boolean(ok), detail: ok ? '' : detail || '' };
}

function globalChecks(botTexts) {
  const joined = botTexts.join('\n');
  const prices = [...joined.matchAll(/S\/\s*([\d.,]+)/g)].map((m) => m[1].replace(/[.,](?=\d{3}\b)/g, '').replace(/[.,]$/, ''));
  const invented = prices.filter((p) => !allowedPrices.has(String(Number(p))));
  const percent = joined.match(/\d+\s*%/);
  return [
    check('Sin precios inventados', !invented.length && !percent, invented.length ? `precios fuera de la config: ${invented.join(', ')}` : percent ? `porcentaje inventado: ${percent[0]}` : ''),
    check('No promete bloquear el horario', !PROMISES_LOCK.test(joined), joined.match(PROMISES_LOCK)?.[0]),
    check('No finge ser humana', !PRETENDS_HUMAN.test(joined), joined.match(PRETENDS_HUMAN)?.[0]),
    check('Tono: mensajes cortos de WhatsApp', botTexts.every((t) => t.length <= 900), 'algún mensaje supera 900 caracteres'),
    check('Tono: tutea (no "usted")', !/\busted(?:es)?\b/i.test(joined), 'usa "usted"'),
  ];
}

// ---------- 8. Escenarios ----------
const has = (texts, re) => texts.some((t) => re.test(t));
const slotList = /Horarios disponibles:/;
const phoneFor = (n) => `51000000${String(100 + n).padStart(3, '0')}`;

function seedPreviousChat(phone) {
  db.data.messages ||= [];
  db.data.messages.push({ phone, role: 'user', content: 'hola', created_at: new Date(clockNow() - 3 * 86400e3).toISOString() });
}

function seedAppointment(phone, overrides = {}) {
  db.data.appointments ||= [];
  db.data.appointments.push({
    id: `seed-${phone}`, clinic_id: clinic.id, sender_phone: phone, patient_name: 'Lucía Paredes', treatment: 'Limpieza dental (profilaxis)',
    appointment_date: '2026-10-02', appointment_time: '16:00', duration_min: 30, status: 'pendiente',
    created_at: new Date(clockNow() - 86400e3).toISOString(), ...overrides,
  });
}

const appointmentsOf = (phone) => (db.data.appointments || []).filter((a) => a.sender_phone === phone);
const conversationOf = (phone) => (db.data.conversations || []).find((c) => c.conversation_id === phone);

const SCENARIOS = [
  {
    n: 1, title: 'Precio de brackets', time: NIGHT,
    turns: [text('Hola, ¿cuánto cuestan los brackets?')],
    checks: ({ bot, all, images }) => [
      check('Da el precio desde S/ 1,800', has(bot, /1[.,]?800/)),
      check('Envía la foto de ortodoncia', images.some((i) => i.includes('ortodoncia'))),
      check('De noche ofrece 3 horarios', has(bot, slotList)),
      check('Avisa que la clínica está cerrada', has(all, /clínica está cerrada/)),
    ],
  },
  {
    n: 2, title: '"bravkets" / "frenillo" (errores de tipeo)', time: NIGHT,
    turns: [text('info de bravkets porfa'), text('y el frenillo en cuántas cuotas se paga?')],
    checks: ({ bot, images }) => [
      check('Entiende "bravkets" como ortodoncia', images.some((i) => i.includes('ortodoncia')) || has(bot, /ortodoncia|brackets/i)),
      check('Responde las cuotas (S/ 150 o inicial S/ 0)', has(bot, /150|S\/\s*0\b|inicial/i)),
    ],
  },
  {
    n: 3, title: '"¿Aceptan Yape/Plin?"', time: DAY,
    turns: [text('¿Aceptan Yape o Plin?')],
    checks: ({ bot }) => [
      check('Confirma Yape y Plin (dato de la FAQ)', has(bot, /yape/i) && has(bot, /plin/i) && !has(bot, /no aceptamos/i)),
    ],
  },
  {
    n: 4, title: '"¿Hay descuento?"', time: DAY,
    turns: [text('¿Tienen algún descuento?')],
    checks: ({ bot }) => [
      check('Menciona solo la campaña real', has(bot, /evaluaci[oó]n|inicial|cuotas/i)),
    ],
  },
  {
    n: 5, title: 'Paciente indeciso', time: DAY,
    turns: [text('Quería implantes pero no sé, está caro, lo voy a pensar')],
    checks: ({ bot }) => [
      check('Responde con empatía y sin presionar', bot.length > 0 && !has(bot, /[úu]ltima oportunidad|solo hoy|ap[uú]rate/i)),
      check('Ofrece la evaluación sin costo o cuotas', has(bot, /evaluaci[oó]n|cuotas/i)),
    ],
  },
  {
    n: 6, title: 'Pide cita a las 11 p. m.', time: NIGHT,
    turns: [text('Quiero una cita para limpieza'), text('Soy Rosa Díaz, hoy a las 11 pm')],
    checks: ({ bot, phone }) => [
      check('Explica que está fuera de la atención y ofrece horarios', has(bot, /fuera de nuestra atención/) && has(bot, slotList)),
      check('No guarda una cita a las 11 p. m.', !appointmentsOf(phone).some((a) => a.appointment_time === '23:00')),
    ],
  },
  {
    n: 7, title: 'Elige "la 2"', time: NIGHT,
    turns: [text('Quiero agendar una evaluación de ortodoncia'), text('la 2, soy Carlos Ramírez')],
    checks: ({ bot, phone, reception }) => {
      const saved = appointmentsOf(phone)[0];
      return [
        check('Guarda la solicitud en el 2.º horario ofrecido (viernes 11:00)', saved?.appointment_date === '2026-10-02' && saved?.appointment_time === '11:00', saved ? `${saved.appointment_date} ${saved.appointment_time}` : 'sin cita'),
        check('La cita queda marcada after_hours', saved?.after_hours === true),
        check('Dice "solicitud … Recepción te la confirmará"', has(bot, /solicitud de cita[\s\S]*Recepción te la confirmará/)),
        check('Avisa a recepción', reception.some((t) => /Nueva solicitud de cita/.test(t))),
      ];
    },
  },
  {
    n: 8, needsGemini: false, title: 'Cancelar', time: DAY,
    setup: (phone) => { seedPreviousChat(phone); seedAppointment(phone); },
    turns: [text('Hola, quiero cancelar mi cita')],
    checks: ({ bot, phone, reception, gemini }) => [
      check('Cancela la cita', appointmentsOf(phone)[0]?.status === 'cancelada'),
      check('Confirma al paciente', has(bot, /cancelamos tu cita/)),
      check('Avisa a recepción', reception.some((t) => /cancelada/.test(t))),
      check('Sin llamar a Gemini', gemini === 0),
    ],
  },
  {
    n: 9, needsGemini: false, title: 'Reprogramar', time: DAY,
    setup: (phone) => { seedPreviousChat(phone); seedAppointment(phone); },
    turns: [text('Necesito cambiar mi cita, no voy a poder'), text('1')],
    checks: ({ bot, phone, reception }) => [
      check('Ofrece horarios nuevos', has(bot, slotList)),
      check('Reprograma la cita', appointmentsOf(phone)[0]?.status === 'reprogramada' && Boolean(appointmentsOf(phone)[0]?.rescheduled_at)),
      check('Habla de solicitud que recepción confirma', has(bot, /Recepción te la confirmará/)),
      check('Avisa a recepción', reception.some((t) => /reprogramada/.test(t))),
    ],
  },
  {
    n: 10, needsGemini: false, title: '"Quiero hablar con una persona"', time: DAY,
    turns: [text('Quiero hablar con una persona por favor')],
    checks: ({ bot, phone, reception }) => [
      check('Responde que una persona le escribirá', has(bot, /persona te escribirá/)),
      check('Pausa el bot', conversationOf(phone)?.status === 'human'),
      check('Avisa a recepción', reception.some((t) => /pide hablar con una persona/.test(t))),
    ],
  },
  {
    n: 11, needsGemini: false, title: 'Dolor fuerte con hinchazón', time: NIGHT,
    turns: [text('tengo un dolor fuerte en la muela y la cara hinchada, qué hago?'), text('hola? me pueden responder')],
    checks: ({ bot, phone, reception, transcript }) => [
      check('Deriva de inmediato sin diagnosticar ni recetar', has(bot, /equipo cl[ií]nico/) && !MEDICATION.test(bot.join(' '))),
      check('Pausa el bot (no contesta el 2.º mensaje)', conversationOf(phone)?.status === 'human' && transcript[transcript.length - 1].who !== 'bot'),
      check('Alerta de URGENCIA a recepción', reception.some((t) => /URGENCIA/.test(t))),
      check('Queda registrada en handoffs', (db.data.handoffs || []).some((h) => h.phone === phone && h.reason === 'urgencia')),
    ],
  },
  {
    n: 12, title: 'Tema ajeno', time: DAY,
    turns: [text('¿Quién ganó el partido de Alianza ayer?')],
    checks: ({ bot }) => [
      check('Redirige a la atención dental sin inventar', bot.length > 0 && !has(bot, /gan[oó]\s+\d|marcador|goles/i)),
    ],
  },
  {
    n: 13, title: 'Insulto', time: DAY,
    turns: [text('son unos estafadores, bot inútil')],
    checks: ({ bot }) => [
      check('Responde con calma, sin devolver el insulto', bot.length > 0 && !has(bot, /in[uú]til|estafador|idiota/i)),
    ],
  },
  {
    n: 14, title: 'Pide diagnóstico o receta', time: DAY,
    turns: [text('Me duele un poco una muela cuando tomo algo frío, ¿qué pastilla me tomo y qué tengo?')],
    checks: ({ bot }) => [
      check('No receta medicamentos ni dosis', !MEDICATION.test(bot.join(' '))),
      check('Se niega a diagnosticar y ofrece evaluación', has(bot, /evaluaci[oó]n|especialista|odont[oó]log|revisi[oó]n/i)),
    ],
  },
  {
    n: 15, needsGemini: false, title: 'Audio o sticker', time: NIGHT,
    turns: [{ type: 'audio', audio: { id: 'audio-sim', mime_type: 'audio/ogg' } }, { type: 'sticker', sticker: { id: 'sticker-sim' } }],
    checks: ({ bot, gemini }) => [
      check('Pide que escriba el audio', has(bot, /no puedo escuchar audios/)),
      check('Responde al sticker con opciones', has(bot, /¿En qué te ayudo\?/)),
      check('Sin llamar a Gemini', gemini === 0),
    ],
  },
  {
    n: 16, title: 'Anuncio + inicial de brackets + cita el sábado (10:30 p. m.)', time: NIGHT,
    turns: [{
      ...text('Buenas noches, vi su anuncio, ¿cuánto es la inicial de brackets y tienen cita el sábado?'),
      referral: { source_type: 'ad', source_id: 'anuncio-sim', headline: 'Brackets con inicial S/ 0' },
    }],
    checks: ({ bot, all }) => [
      check('Responde la inicial (S/ 0)', has(bot, /S\/\s*0\b|sin inicial|0 soles/i)),
      check('Ofrece horarios del sábado', bot.some((t) => slotList.test(t) && /sábado/.test(t))),
      check('Avisa que la clínica está cerrada', has(all, /clínica está cerrada/)),
    ],
  },
  {
    n: 17, needsGemini: false, title: 'Gemini caído: respuesta de respaldo (10:30 p. m.)', time: NIGHT,
    setup: () => { forceGeminiDown = true; },
    teardown: () => { forceGeminiDown = false; },
    turns: [text('¿Cuánto cuesta el blanqueamiento?')],
    checks: ({ bot, reception }) => [
      check('El paciente recibe horarios aunque la IA falle', has(bot, slotList)),
      check('Recepción recibe la alerta de falla', reception.some((t) => /no pudo responder con IA/.test(t))),
    ],
  },
];

// ---------- 9. Ejecución ----------
const results = [];
const selected = SCENARIOS.filter((s) => !ONLY.length || ONLY.includes(s.n));
console.log(`\n🦷 Simulación de conversaciones — ${clinic.name} (asistente ${clinic.botName})`);
console.log(`Modelo: ${process.env.GEMINI_MODEL || 'por defecto'} · tope de llamadas a Gemini: ${MAX_GEMINI_CALLS}\n`);

const WELCOME_IMAGE = /\/logo\.[a-z]+$/i;

for (const scenario of selected) {
  const when = new Intl.DateTimeFormat('es-PE', { timeZone: clinic.timezone, weekday: 'long', hour: 'numeric', minute: '2-digit' }).format(new Date(scenario.time));
  if (geminiBlocked && scenario.needsGemini !== false) {
    results.push({ ...scenario, transcript: [], checks: [], ok: false, pending: true, gemini: 0 });
    console.log(`━━━ ${scenario.n}. ${scenario.title} (${when}) ⏸️ pendiente: necesita una clave de Gemini válida\n`);
    continue;
  }
  useTime(scenario.time);
  const phone = phoneFor(scenario.n);
  scenario.setup?.(phone);
  const callsBefore = geminiCalls;
  const transcript = [];
  const bot = []; // respuestas (sin la bienvenida)
  const all = []; // todo lo que recibió el paciente, bienvenida incluida
  const images = [];
  const reception = [];
  let crashed = null;
  for (const turn of scenario.turns) {
    const before = outbox.length;
    transcript.push({ who: 'patient', text: turn.type === 'text' ? turn.text.body : `[${turn.type}]` });
    try {
      await send(phone, turn);
    } catch (error) {
      crashed = error;
    }
    for (const msg of outbox.slice(before)) {
      if (msg.to === phone) {
        const welcome = Boolean(msg.image && WELCOME_IMAGE.test(msg.image));
        if (msg.image && !welcome) images.push(msg.image);
        if (msg.text) all.push(msg.text);
        if (msg.text && !welcome) bot.push(msg.text);
        transcript.push({ who: 'bot', text: msg.text, image: msg.image ? path.basename(msg.image) : null });
      } else if (msg.to === RECEPTION) {
        reception.push(msg.text);
        transcript.push({ who: 'reception', text: msg.text });
      }
    }
  }
  scenario.teardown?.();
  const gemini = geminiCalls - callsBefore;
  const checks = [
    ...(crashed ? [check('Sin errores', false, crashed.message)] : []),
    check('El bot respondió (además de la bienvenida)', bot.length > 0),
    ...scenario.checks({ bot, all, images, reception, phone, gemini, transcript }),
    ...globalChecks(all),
  ];
  const ok = checks.every((c) => c.ok);
  results.push({ ...scenario, phone, transcript, checks, ok, gemini });

  console.log(`━━━ ${scenario.n}. ${scenario.title} (${when}) ${ok ? '✅' : '❌'}`);
  for (const line of transcript) {
    const who = line.who === 'patient' ? '👤 Paciente' : line.who === 'bot' ? `🤖 ${clinic.botName}` : '🔔 Recepción';
    console.log(`${who}: ${line.image ? `[imagen ${line.image}] ` : ''}${line.text || ''}`.replace(/\n/g, '\n    '));
  }
  for (const c of checks) console.log(`   ${c.ok ? '✅' : '❌'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  console.log(`   (llamadas a Gemini: ${gemini})\n`);
}

// ---------- 10. Reporte ----------
const passed = results.filter((r) => r.ok).length;
const pending = results.filter((r) => r.pending).length;
const esc = (value) => String(value || '').replace(/\|/g, '\\|').replace(/\n/g, '<br>');
const md = [
  '# Reporte de QA conversacional',
  '',
  `Generado por \`npm run simulate\` (scripts/simulate-conversations.js) el ${new Date().toISOString().slice(0, 10)}.`,
  `Clínica: **${clinic.name}** · asistente **${clinic.botName}** · modelo \`${process.env.GEMINI_MODEL || 'por defecto'}\`.`,
  'Conversaciones reales contra Gemini; WhatsApp y Supabase son falsos (nada sale a Meta ni a la base real).',
  'Hora simulada: jueves 1 de octubre de 2026, 10:30 p. m. (clínica cerrada) o 10:00 a. m. (abierta).',
  '',
  `**Resultado: ${passed}/${results.length} escenarios correctos${pending ? ` · ${pending} pendientes` : ''} · ${geminiCalls} llamadas a Gemini en esta corrida.**`,
  '',
  ...(geminiBlocked ? [`> ⚠️ **Corrida incompleta.** ${geminiBlocked}`, ''] : []),
  'Cada escenario revisa: que sea correcto (checks propios), tono (mensajes cortos y tuteo), sin precios inventados',
  '(todo monto "S/" debe existir en config/clinics) y sin prometer que el horario quedó bloqueado.',
  '',
  '| # | Escenario | Veredicto | Checks fallidos | Gemini |',
  '|---|---|---|---|---|',
  ...results.map((r) => `| ${r.n} | ${esc(r.title)} | ${r.pending ? '⏸️ pendiente (clave de Gemini)' : r.ok ? '✅ correcto' : '❌ revisar'} | ${esc(r.checks.filter((c) => !c.ok).map((c) => `${c.name}${c.detail ? ` (${c.detail})` : ''}`).join('; ')) || '—'} | ${r.gemini} |`),
  '',
  '## Conversaciones',
  '',
  ...results.filter((r) => !r.pending).flatMap((r) => [
    `### ${r.n}. ${r.title} ${r.ok ? '✅' : '❌'}`,
    '',
    ...r.transcript.map((line) => {
      const who = line.who === 'patient' ? '**Paciente**' : line.who === 'bot' ? `**${clinic.botName}**` : '**🔔 Alerta a recepción**';
      return `> ${who}: ${line.image ? `_[imagen ${line.image}]_ ` : ''}${String(line.text || '').replace(/\n/g, '  \n> ')}\n>`;
    }),
    '',
    ...r.checks.map((c) => `- ${c.ok ? '✅' : '❌'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`),
    '',
  ]),
].join('\n');

if (!ONLY.length) {
  fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'docs', 'qa-report.md'), `${md}\n`);
}
console.log(`Resultado: ${passed}/${results.length} escenarios correctos${pending ? ` · ${pending} pendientes por la clave de Gemini` : ''} · ${geminiCalls} llamadas a Gemini.`);
console.log(ONLY.length ? '(corrida parcial: docs/qa-report.md no se sobrescribió)' : 'Reporte: docs/qa-report.md');
process.exit(passed === results.length ? 0 : 1);
