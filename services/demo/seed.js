import { addDays, localParts, toInstant } from '../appointmentService.js';

// Datos INVENTADOS para el modo demo (npm run demo). Solo viven en memoria: nunca se escriben en Supabase.
// Los nombres son ficticios y los números usan el prefijo 5190000 (no se envía nada a ellos: en modo demo
// WhatsApp es falso). Precios, nombre de la asistente, campaña y fotos salen de la clínica activa.

export const DEMO_PHONE_PREFIX = '5190000';
export const isDemoPhone = (phone) => String(phone || '').replace(/\D/g, '').startsWith(DEMO_PHONE_PREFIX);
const phoneOf = (n) => `${DEMO_PHONE_PREFIX}${String(n).padStart(4, '0')}`;

const soles = (value) => `S/ ${Number(value).toLocaleString('es-PE')}`;
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export function buildDemoData(clinic, now = new Date()) {
  const tz = clinic.timezone;
  const today = localParts(tz, now).date;
  const at = (daysAgo, hhmm) => toInstant(addDays(today, -daysAgo), hhmm, tz);
  const minutesAgo = (m) => new Date(now.getTime() - m * 60e3);
  const iso = (d) => d.toISOString();
  const plus = (d, seconds) => new Date(d.getTime() + seconds * 1000);

  // Tratamiento por clave, con respaldo a uno activo: funciona con cualquier clínica.
  const active = clinic.treatments.filter((t) => t.active !== false);
  const t = (key, fallbackIndex = 0) => active.find((x) => x.key === key) || active[fallbackIndex % active.length];
  const photo = (key) => (clinic.media?.[key] ? `/media/${clinic.id}/${clinic.media[key]}` : null);
  const campaign = [clinic.campaign?.evaluation, clinic.campaign?.initialFee].filter(Boolean).join(' y ') || 'nuestra evaluación';
  const installments = clinic.campaign?.installments ? `${clinic.campaign.installments}.` : 'Tenemos facilidades de pago.';
  const ad = (treatment) => ({ source_type: 'ad', headline: `${treatment.name.split(' (')[0]} — ${clinic.campaign?.evaluation || 'Evaluación'}` });

  // Próximo sábado con atención (o el siguiente día con atención si la clínica no abre los sábados).
  const nextOpen = (weekday) => {
    for (let i = 1; i <= 7; i += 1) {
      const date = addDays(today, i);
      if (new Date(`${date}T12:00:00Z`).getUTCDay() === weekday && (clinic.workingHours?.[WEEKDAYS[weekday]] || []).length) return date;
    }
    return addDays(today, 1);
  };

  const ortho = t('ortodoncia', 0);
  const implant = t('implantes', 1);
  const veneers = t('carillas', 2);
  const whitening = t('blanqueamiento', 3);
  const cleaning = t('limpieza', 4);
  const kids = t('odontopediatria', 5);
  const bot = clinic.botName;

  const people = [
    {
      n: 101, name: 'Carlos Mendoza', start: at(1, '23:15'), afterHours: true, score: ['caliente', 'Dejó una solicitud de cita'],
      treatment: ortho, adReferral: ad(ortho), notes: 'Vio el anuncio de brackets. Prefiere sábados.',
      chat: [
        ['patient', 'hola'], ['patient', 'vi su anuncio de brackets'], ['patient', 'cuánto es la inicial?'],
        ['bot', `¡Hola, Carlos! Soy ${bot} 😊. Por lo que me cuentas, lo indicado es una evaluación de ortodoncia; el doctor confirma el mejor tratamiento. ${ortho.name} es desde ${soles(ortho.priceFrom)} y tenemos ${campaign}. ¿Te propongo 3 horarios?`, photo(ortho.key)],
        ['patient', 'sí, el sábado en la mañana'],
        ['bot', 'Listo, registré tu solicitud de cita para el sábado a las 10:00 a. m. Recepción te la confirmará por aquí a primera hora 🙌'],
      ],
      appointment: { date: nextOpen(6), time: '10:00:00', status: 'pendiente' },
    },
    {
      n: 102, name: 'Mariana Paredes', start: at(3, '11:02'), afterHours: false, score: ['caliente', 'Dejó una solicitud de cita'],
      treatment: implant, adReferral: ad(implant), tags: ['vip'], notes: 'Implante de molar inferior. Confirmada por recepción.',
      chat: [
        ['patient', 'Buenos días, me sacaron una muela de abajo hace un año y quiero ponerme un implante'],
        ['bot', `¡Buenos días, Mariana! Por lo que me cuentas, lo indicado es una evaluación de implante dental; el doctor confirma el mejor tratamiento. ${implant.name} es desde ${soles(implant.priceFrom)}. ${installments} ¿Te comparto horarios?`, photo(implant.key)],
        ['patient', 'sí por favor, en la tarde'],
        ['bot', 'Registré tu solicitud de cita. Recepción te la confirmará en unos minutos 😊'],
        ['reception', '¡Hola, Mariana! Te confirmamos tu evaluación. Te esperamos 🦷'],
      ],
      appointment: { date: today, time: '16:00:00', status: 'confirmada', confirmedHoursLater: 1 },
    },
    {
      n: 103, name: 'Rodrigo Silva', start: at(2, '18:20'), afterHours: false, score: ['tibio', 'Lo está pensando: pedir permiso para un seguimiento'],
      treatment: veneers, tags: ['precio_sensible'], notes: 'Duda entre carillas y diseño de sonrisa. Seguimiento pendiente.',
      chat: [
        ['patient', 'Hola, cuánto cuestan las carillas o el diseño de sonrisa?'],
        ['bot', `¡Hola, Rodrigo! ${veneers.name} es desde ${soles(veneers.priceFrom)}; el costo exacto se define en la evaluación. ${installments} ¿Lo buscas para alguna fecha en especial?`, photo(veneers.key)],
        ['patient', 'ok, lo voy a pensar'],
        ['bot', 'Claro, tómate tu tiempo 😊. ¿Te parece si mañana te escribo para resolver cualquier duda?'],
        ['patient', 'ya, dale'],
      ],
    },
    {
      n: 104, name: 'Sofía Benavides', start: at(1, '22:48'), afterHours: true, urgent: true, score: ['caliente', 'Urgencia: la atiende recepción'],
      notes: 'Dolor fuerte. Recepción la llamó.',
      chat: [
        ['patient', 'hola tengo un dolor muy fuerte en una muela, no aguanto el dolor'],
        ['bot', 'Lamento que estés con esa molestia 🙏. Ya avisé a nuestro equipo clínico y te escribirán de inmediato por este chat. Por aquí no puedo darte diagnóstico ni indicarte medicamentos. Si el dolor, el sangrado o la hinchazón aumentan, acude a emergencias.'],
      ],
    },
    {
      n: 105, name: 'Lucía Ramírez', start: at(2, '21:40'), afterHours: true, score: ['caliente', 'Dejó una solicitud de cita'],
      treatment: whitening, adReferral: ad(whitening),
      chat: [
        ['patient', 'Hola! tengo los dientes amarillos, hacen blanqueamiento?'],
        ['bot', `¡Hola, Lucía! Sí 😊. Por lo que me cuentas, lo indicado es una evaluación de blanqueamiento dental; el doctor confirma el mejor tratamiento. ${whitening.name} es desde ${soles(whitening.priceFrom)}. ¿Te propongo horarios?`, photo(whitening.key)],
        ['patient', 'la 2'],
        ['bot', 'Registré tu solicitud de cita. Recepción te la confirmará mañana a primera hora 🌙'],
      ],
      appointment: { date: addDays(today, 1), time: '11:30:00', status: 'confirmada', confirmedHoursLater: 11 },
    },
    {
      n: 106, name: 'Jorge Castillo', start: at(1, '10:31'), afterHours: false, score: ['caliente', 'Dejó una solicitud de cita'],
      treatment: cleaning,
      chat: [
        ['patient', 'Buenas, quiero sacar cita para una limpieza'],
        ['bot', `¡Hola, Jorge! ${cleaning.name} es desde ${soles(cleaning.priceFrom)}. Te comparto los horarios más cercanos para tu cita.`],
        ['patient', 'el primero'],
        ['bot', 'Listo, registré tu solicitud de cita. Recepción te la confirmará por aquí 😊'],
      ],
      appointment: { date: today, time: '17:30:00', status: 'pendiente' },
    },
    {
      n: 107, name: 'Valeria Torres', start: at(3, '22:05'), afterHours: true, score: ['caliente', 'Dejó una solicitud de cita'],
      treatment: kids, botNotes: 'Su hijo tiene 8 años y le dan miedo los dentistas.',
      chat: [
        ['patient', 'hola, es para mi hijo de 8 años, atienden niños?'],
        ['bot', `¡Hola, Valeria! Sí 😊. Por lo que me cuentas, lo indicado es una evaluación de odontopediatría; el doctor confirma el mejor tratamiento. ${kids.name} es desde ${soles(kids.priceFrom)}. ¿Te propongo horarios?`],
        ['patient', 'sí, mañana después del colegio'],
        ['bot', 'Registré tu solicitud de cita. Recepción te la confirmará mañana a primera hora 🌙'],
      ],
      appointment: { date: addDays(today, 1), time: '15:30:00', status: 'pendiente' },
    },
    {
      n: 108, name: 'Patricia Flores', start: at(4, '23:32'), afterHours: true, score: ['caliente', 'Tiene un evento pronto'],
      treatment: veneers, adReferral: ad(veneers),
      chat: [
        ['patient', 'hola me caso en un mes y quiero una sonrisa bonita'],
        ['bot', `¡Felicitaciones, Patricia! 💍 Por lo que me cuentas, lo indicado es una evaluación de diseño de sonrisa o blanqueamiento; el doctor confirma el mejor tratamiento. ${veneers.name} es desde ${soles(veneers.priceFrom)}. ¿Para qué fecha es tu boda?`],
        ['patient', 'a fin de mes'],
        ['bot', 'Llegamos con tiempo 🙌. Registré tu solicitud de cita. Recepción te la confirmará por aquí.'],
      ],
      appointment: { date: addDays(today, 2), time: '10:00:00', status: 'pendiente' },
    },
    {
      n: 109, name: 'Andrés Quispe', start: at(5, '12:15'), afterHours: false, score: ['tibio', 'Preguntó por precios o tratamientos'],
      treatment: ortho,
      chat: [
        ['patient', 'cuánto cuestan los brackets? se puede en cuotas?'],
        ['bot', `¡Hola, Andrés! ${ortho.name} es desde ${soles(ortho.priceFrom)}. ${installments} ¿Quieres que te proponga horarios para tu evaluación?`],
      ],
    },
    {
      n: 110, name: 'Renato Díaz', start: at(6, '16:40'), afterHours: false, score: ['tibio', 'Le preocupa el precio: ofrecer cuotas'],
      treatment: implant, tags: ['precio_sensible'],
      chat: [
        ['patient', 'precio del implante?'],
        ['bot', `¡Hola, Renato! ${implant.name} es desde ${soles(implant.priceFrom)}; el costo exacto se define en la evaluación.`],
        ['patient', 'está caro'],
        ['bot', `Te entiendo 🙏. Es un precio "desde" y en la evaluación el doctor te dice el costo exacto. ${installments}`],
      ],
    },
    {
      n: 111, name: 'Miguel Rojas', start: minutesAgo(38), score: ['frio', 'Solo saludó'], unread: 1,
      chat: [['patient', 'hola buenas']],
    },
    {
      n: 112, name: 'Diana Vargas', start: minutesAgo(95), score: ['frio', 'Sin interés concreto todavía'],
      chat: [
        ['patient', 'dónde están ubicados?'],
        ['bot', `Estamos en ${clinic.address} 📍 ${clinic.mapsUrl}`, photo('ubicacion')],
        ['patient', 'gracias'],
      ],
    },
  ];

  const data = { conversations: [], messages: [], appointments: [], leads: [], handoffs: [] };
  let messageId = 1;
  for (const p of people) {
    const phone = phoneOf(p.n);
    let when = p.start;
    let last = null;
    let lastInbound = null;
    let firstResponseMs = null;
    for (const [sender, text, media] of p.chat) {
      // Paciente: escribe cada 25-85 s. Bot: responde en 4-8 s (tras el debounce).
      when = plus(when, sender === 'patient' ? (when === p.start ? 0 : 25 + (messageId % 4) * 20) : 4 + (messageId % 3) * 2);
      if (sender === 'bot' && firstResponseMs === null) firstResponseMs = when - p.start;
      data.messages.push({
        id: messageId, phone, role: sender === 'patient' ? 'user' : 'assistant', sender, content: text,
        msg_type: media ? 'image' : 'text', media_url: media || null, status: sender === 'patient' ? null : 'read',
        whatsapp_message_id: `wamid.demo.${messageId}`, created_at: iso(when), is_test: false,
      });
      messageId += 1;
      last = { text, at: when };
      if (sender === 'patient') lastInbound = when;
    }
    const afterHours = Boolean(p.afterHours);
    data.conversations.push({
      conversation_id: phone, phone, contact_name: p.name, last_message: String(last.text).slice(0, 200), last_message_at: iso(last.at),
      updated_at: iso(last.at), created_at: iso(p.start), status: p.urgent ? 'human' : 'active', handoff_reason: p.urgent ? 'urgencia' : null,
      unread_count: p.unread || (p.urgent ? 1 : 0), after_hours: afterHours, first_message_at: iso(p.start), first_response_ms: firstResponseMs,
      last_inbound_at: lastInbound ? iso(lastInbound) : null, is_test: false,
    });
    data.leads.push({
      telefono: phone.slice(-9), nombre: p.name, clinic_id: clinic.id, lead_score: p.score[0], lead_score_reason: p.score[1],
      lead_score_at: iso(last.at), treatment_interest: p.treatment?.name || null, tags: p.tags || [], notes: p.notes || null,
      bot_notes: p.botNotes || null, ad_referral: p.adReferral || null, after_hours: afterHours, created_at: iso(p.start), updated_at: iso(last.at),
    });
    if (p.urgent) data.handoffs.push({ clinic_id: clinic.id, phone, reason: 'urgencia', after_hours: afterHours, created_at: iso(plus(p.start, 6)) });
    if (p.appointment) {
      const requestedAt = plus(last.at, 1);
      data.appointments.push({
        clinic_id: clinic.id, sender_phone: phone, patient_name: p.name, treatment: p.treatment.name,
        appointment_date: p.appointment.date, appointment_time: p.appointment.time, duration_min: p.treatment.durationMin || 30,
        status: p.appointment.status, source: 'whatsapp', ad_referral: p.adReferral || null, after_hours: afterHours,
        confirmed_at: p.appointment.confirmedHoursLater ? iso(plus(requestedAt, p.appointment.confirmedHoursLater * 3600)) : null,
        created_at: iso(requestedAt), updated_at: iso(requestedAt), is_test: false,
      });
    }
  }
  return data;
}

export default buildDemoData;
