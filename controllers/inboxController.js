import activeClinic, { activeTreatments } from '../config/clinic.config.js';
import TEMPLATES from '../config/whatsappTemplates.js';
import defaultInbox, { INBOX_FILTERS } from '../services/inboxService.js';
import defaultEvents from '../services/liveEvents.js';
import defaultHandoff from '../services/handoffService.js';
import defaultJobs from '../services/jobsService.js';
import { describeMetaError } from '../services/metaErrors.js';
import { fetchMetaMedia, isInlineType } from '../services/metaMedia.js';
import { getSupabase } from '../services/supabaseClient.js';
import defaultLeads from '../services/leadService.js';
import { PROFILE_TAGS, sanitizeBotNotes } from '../services/recommendationService.js';

// Bandeja en vivo del panel: lista, chat, respuestas de recepción, stream SSE y proxy de media.

const HEARTBEAT_MS = 25 * 1000;
const MAX_STREAMS = Number(process.env.PANEL_MAX_STREAMS || 20);
const MAX_TEXT = 4096;
const digits = (value) => String(value || '').replace(/\D/g, '');
const PROFILE_LIMITS = { nombre: 80, treatmentInterest: 80, notes: 1000, botNotes: 500 };

function toProfile(lead) {
  return {
    nombre: lead?.nombre || '',
    treatmentInterest: lead?.treatment_interest || '',
    tags: Array.isArray(lead?.tags) ? lead.tags.filter((t) => PROFILE_TAGS.includes(t)) : [],
    notes: lead?.notes || '',
    botNotes: lead?.bot_notes || '',
    leadScore: lead?.lead_score || null,
    leadScoreReason: lead?.lead_score_reason || null,
  };
}

// Valida la ficha que envía recepción. Solo se guardan los campos presentes; devuelve { fields } o { error }.
export function parseProfile(body = {}) {
  const fields = {};
  for (const key of ['nombre', 'treatmentInterest', 'notes', 'botNotes']) {
    if (body[key] === undefined) continue;
    if (body[key] !== null && typeof body[key] !== 'string') return { error: `"${key}" debe ser texto` };
    const value = String(body[key] || '').trim();
    if (value.length > PROFILE_LIMITS[key]) return { error: `"${key}": máximo ${PROFILE_LIMITS[key]} caracteres` };
    fields[key] = value;
  }
  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags)) return { error: '"tags" debe ser una lista' };
    const unknown = body.tags.find((t) => !PROFILE_TAGS.includes(t));
    if (unknown !== undefined) return { error: `Etiqueta desconocida: ${String(unknown).slice(0, 30)}` };
    fields.tags = [...new Set(body.tags)];
  }
  // Las notas para el bot se guardan ya saneadas: lo que ve recepción es lo que entra al prompt.
  if (fields.botNotes !== undefined) fields.botNotes = sanitizeBotNotes(fields.botNotes, PROFILE_LIMITS.botNotes);
  if (!Object.keys(fields).length) return { error: 'No hay cambios en la ficha' };
  return { fields };
}

// Plantillas que recepción puede usar para retomar una conversación fuera de la ventana de 24 h.
export function receptionTemplates(clinic = activeClinic) {
  const campaign = [clinic.campaign?.evaluation, clinic.campaign?.initialFee].filter(Boolean).join(' y ') || 'nuestra campaña';
  return [{
    key: 'reactivation',
    name: TEMPLATES.reactivation.name,
    language: TEMPLATES.reactivation.language,
    label: 'Retomar la conversación (reactivación)',
    params: TEMPLATES.reactivation.params({ clinicName: clinic.name, campaign }),
    preview: `Plantilla aprobada "${TEMPLATES.reactivation.name}" con ${clinic.name} y la campaña: ${campaign}.`,
  }];
}

function sendError(res, error, fallback) {
  const status = Number(error?.status) >= 400 && Number(error?.status) < 600 ? Number(error.status) : 500;
  console.error(`[Bandeja] ${fallback}:`, error?.message || error);
  return res.status(status).json({ error: status === 500 ? fallback : error.message || fallback });
}

export function createInboxController({
  inbox = defaultInbox, events = defaultEvents, handoff = defaultHandoff, jobs = defaultJobs,
  getClient = getSupabase, fetchMedia = fetchMetaMedia, heartbeatMs = HEARTBEAT_MS, leads = defaultLeads,
} = {}) {
  let openStreams = 0;

  async function list(req, res) {
    const filter = INBOX_FILTERS.includes(req.query.filter) ? req.query.filter : 'all';
    try {
      return res.json(await inbox.listConversations({ filter, q: String(req.query.q || '').slice(0, 80) }));
    } catch (error) {
      return sendError(res, error, 'No se pudo cargar la bandeja');
    }
  }

  async function messages(req, res) {
    const phone = digits(req.params.phone);
    if (!phone) return res.status(400).json({ error: 'Teléfono inválido' });
    const since = req.query.since && !Number.isNaN(Date.parse(req.query.since)) ? req.query.since : null;
    try {
      const [items, window] = await Promise.all([inbox.getMessages(phone, { since }), inbox.windowState(phone)]);
      const paused = await handoff.isPaused(phone);
      return res.json({ phone, messages: items, window, paused, templates: window.open ? [] : receptionTemplates() });
    } catch (error) {
      return sendError(res, error, 'No se pudo cargar la conversación');
    }
  }

  // Recepción responde: se envía por WhatsApp, se guarda como "recepción" y el bot queda en pausa.
  async function send(req, res) {
    const phone = digits(req.params.phone);
    const text = String(req.body?.text || '').trim();
    const templateKey = req.body?.template ? String(req.body.template) : null;
    if (!phone) return res.status(400).json({ error: 'Teléfono inválido' });
    if (!templateKey && !text) return res.status(400).json({ error: 'Escribe un mensaje' });
    if (text.length > MAX_TEXT) return res.status(400).json({ error: `Máximo ${MAX_TEXT} caracteres` });
    const template = templateKey ? receptionTemplates().find((t) => t.key === templateKey) : null;
    if (templateKey && !template) return res.status(400).json({ error: 'Plantilla desconocida' });

    let window;
    try {
      window = await inbox.windowState(phone);
    } catch (error) {
      return sendError(res, error, 'No se pudo revisar la ventana de 24 h');
    }
    if (!template && !window.open) {
      return res.status(409).json({
        error: 'Pasaron más de 24 h desde el último mensaje del paciente: WhatsApp solo permite enviar una plantilla aprobada.',
        code: 'outside_window', templates: receptionTemplates(),
      });
    }

    const sent = {};
    try {
      // sendWithWindow decide: texto libre dentro de las 24 h, plantilla aprobada fuera de ellas.
      const channel = await jobs.sendWithWindow(phone, template
        ? { text: template.preview, template: TEMPLATES.reactivation, params: template.params }
        : { text, template: TEMPLATES.reactivation, params: receptionTemplates()[0].params }, sent);
      if (!template && channel !== 'text') throw Object.assign(new Error('La ventana de 24 h se cerró mientras escribías.'), { status: 409 });
      await handoff.setPaused(phone, true, 'recepcion');
      const message = await inbox.recordMessage({
        phone, sender: 'reception', type: channel === 'template' ? 'template' : 'text',
        text: channel === 'template' ? `📨 ${template?.preview || 'Plantilla de reactivación'}` : text,
        wamid: sent.result?.messages?.[0]?.id || null,
      });
      return res.json({ ok: true, channel, message, paused: true });
    } catch (error) {
      const reason = error?.meta ? describeMetaError(error.meta) : error?.status === 409 ? error.message : 'No se pudo enviar por WhatsApp. Revisa la conexión y el token (npm run preflight).';
      const failed = await inbox.recordMessage({
        phone, sender: 'reception', text: text || template?.preview || null, type: template ? 'template' : 'text',
        status: 'failed', statusError: reason,
      }).catch(() => null);
      console.error('[Bandeja] Envío de recepción falló:', error?.message || error);
      return res.status(error?.status === 409 ? 409 : 502).json({ error: reason, message: failed });
    }
  }

  async function read(req, res) {
    try {
      return res.json(await inbox.markRead(req.params.phone));
    } catch (error) {
      return sendError(res, error, 'No se pudo marcar como leído');
    }
  }

  // "Intervenir" / "Devolver al bot".
  async function setBot(req, res) {
    const phone = digits(req.params.phone);
    if (!phone || typeof req.body?.paused !== 'boolean') return res.status(400).json({ error: 'Envía { paused: true|false }' });
    try {
      const paused = await handoff.setPaused(phone, req.body.paused, req.body.paused ? 'recepcion' : null);
      return res.json({ phone, paused });
    } catch (error) {
      return sendError(res, error, 'No se pudo cambiar el estado del bot');
    }
  }

  // Ficha del paciente: nombre, tratamiento de interés, etiquetas, notas internas y notas "para el bot".
  async function profile(req, res) {
    const phone = digits(req.params.phone);
    if (!phone) return res.status(400).json({ error: 'Teléfono inválido' });
    try {
      const lead = await leads.getByPhone(phone);
      return res.json({ phone, profile: toProfile(lead), tags: PROFILE_TAGS, treatments: activeTreatments(activeClinic).map((t) => t.name) });
    } catch (error) {
      return sendError(res, error, 'No se pudo cargar la ficha (¿falta migrations/20260930_lead_profile.sql?)');
    }
  }

  async function saveProfile(req, res) {
    const phone = digits(req.params.phone);
    if (!phone) return res.status(400).json({ error: 'Teléfono inválido' });
    const { fields, error } = parseProfile(req.body || {});
    if (error) return res.status(400).json({ error });
    try {
      const lead = await leads.saveLeadProfile(phone, fields);
      const saved = toProfile(lead);
      events.publish('conversation', { phone, tags: saved.tags, name: saved.nombre || null });
      return res.json({ phone, profile: saved });
    } catch (err) {
      return sendError(res, err, 'No se pudo guardar la ficha (¿falta migrations/20260930_lead_profile.sql?)');
    }
  }

  // Proxy autenticado: el navegador pide /api/panel/media/:id y el servidor descarga de Meta con el token.
  // Solo sirve media que llegó en una conversación de esta clínica.
  async function media(req, res) {
    const mediaId = String(req.params.mediaId || '');
    if (!/^\d{5,30}$/.test(mediaId)) return res.status(400).json({ error: 'Archivo inválido' });
    try {
      const client = await getClient();
      if (client) {
        const { data, error } = await client.from('messages').select('id').eq('media_id', mediaId).limit(1).maybeSingle();
        if (error || !data) return res.status(404).json({ error: 'Archivo no encontrado' });
      }
      const { contentType, buffer } = await fetchMedia(mediaId);
      const inline = isInlineType(contentType);
      res.set({
        'Content-Type': inline ? contentType : 'application/octet-stream',
        'Content-Disposition': inline ? 'inline' : 'attachment; filename="archivo-del-paciente"',
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      });
      return res.send(buffer);
    } catch (error) {
      return sendError(res, error, 'No se pudo descargar el archivo de WhatsApp');
    }
  }

  // Server-Sent Events. Reconexión: el navegador manda Last-Event-ID y recibe lo que se perdió;
  // si el servidor se reinició o el hueco es muy grande, recibe "resync" y recarga desde la API.
  function stream(req, res) {
    if (openStreams >= MAX_STREAMS) return res.status(503).json({ error: 'Demasiadas pantallas abiertas del panel' });
    openStreams += 1;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const write = (event) => res.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
    res.write('retry: 3000\n\n');
    const lastId = req.get('Last-Event-ID') || req.query.lastEventId || null;
    const { events: missed, resync } = events.since(lastId);
    if (resync) res.write(`event: resync\ndata: {}\n\n`);
    res.write(`event: ready\ndata: ${JSON.stringify({ bootId: events.bootId, role: req.panelSession?.role || null })}\n\n`);
    missed.forEach(write);
    const unsubscribe = events.subscribe(write);
    // Keep-alive de la conexión (no es una tarea periódica): evita que Render la corte por inactividad.
    const heartbeat = setInterval(() => res.write(': ping\n\n'), heartbeatMs);
    heartbeat.unref?.();
    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      openStreams -= 1;
    });
    return undefined;
  }

  return { list, messages, send, read, setBot, media, stream, profile, saveProfile };
}

export default createInboxController();
