import { h } from '../dom.js';
import { area, check, field, livePreview, number, section, select, text } from './ui.js';

// Mi clínica → Asistente: nombre, tono, emojis, bienvenida, modo de agendamiento (con vista previa del pase),
// recordatorios y seguimiento cuando el paciente no responde.

export function assistantSection(c) {
  const botName = text(c.botName, { maxlength: 40 });
  const tone = select(c.tone || 'cercano', [['cercano', 'Cercano (tutea)'], ['formal', 'Formal (usted)'], ['juvenil', 'Juvenil']]);
  const emojis = select(c.emojiLevel || 'pocos', [['pocos', 'Pocos (máx. 1)'], ['ninguno', 'Ninguno'], ['normal', 'Normal (máx. 3)']]);
  const welcome = area(c.welcomeCaption, { maxlength: 1200, rows: 7 });
  const night = area(c.afterHoursNotice || '', { maxlength: 400, rows: 2, placeholder: '🌙 Ahora la clínica está cerrada, pero yo te ayudo ya mismo…' });
  const bookingMode = select(c.bookingMode || 'solicitud', [
    ['solicitud', 'Solicitud: recepción confirma cada cita (recomendado)'],
    ['confirmacion_directa', 'Confirmación directa: el bot reserva y envía el pase de cita'],
  ]);
  const codePrefix = text(c.appointmentCodePrefix || '', { maxlength: 4, placeholder: 'DV', pattern: '[A-Z]{2,4}' });
  const bookingWarning = h('p', { class: 'hint hint--warn', role: 'note' },
    '⚠️ Usa la confirmación directa solo si la Agenda de este panel es la ÚNICA agenda de la clínica. '
    + 'Si recepción también agenda en un cuaderno, Excel u otro sistema, el bot podría confirmar un horario que ya está ocupado allí.');
  const passPreview = livePreview('pass', () => ({ colors: c.colors, specialists: c.specialists, name: c.name }), 'Vista previa de un pase de cita de ejemplo');
  const syncWarning = () => {
    const direct = bookingMode.value === 'confirmacion_directa';
    bookingWarning.hidden = !direct;
    passPreview.hidden = !direct;
  };
  bookingMode.addEventListener('change', syncWarning);
  syncWarning();
  // Recordatorios: horas antes de la cita (0 = no enviar ese recordatorio).
  const firstReminder = number(c.reminders?.firstHours === null ? 0 : c.reminders?.firstHours ?? 48, { min: 0, max: 96, step: 1 });
  const secondReminder = number(c.reminders?.secondHours === null ? 0 : c.reminders?.secondHours ?? 2, { min: 0, max: 6, step: 1 });
  const hoursOrNull = (input) => (Number(input.value) > 0 ? Math.round(Number(input.value)) : null);
  // Seguimiento ético cuando el paciente no responde (activado por defecto).
  const fu = { enabled: true, firstHours: 3, secondHours: 22, thirdDays: 3, ...(c.followUps || {}) };
  const followEnabled = check(fu.enabled);
  const followFirst = number(fu.firstHours, { min: 1, max: 12, step: 1 });
  const followSecond = number(fu.secondHours, { min: 2, max: 23, step: 1 });
  const followDays = number(fu.thirdDays, { min: 2, max: 7, step: 1 });
  const preview = h('div', { class: 'preview', 'aria-live': 'polite' });
  const updatePreview = () => { preview.textContent = [welcome.value, night.value ? `(de noche) ${night.value}` : null].filter(Boolean).join('\n\n'); };
  welcome.addEventListener('input', updatePreview);
  night.addEventListener('input', updatePreview);
  updatePreview();
  return section({
    id: 'assistant', title: '🤖 Asistente: tono, bienvenida, citas, recordatorios y seguimiento',
    fields: ['botName', 'tone', 'emojiLevel', 'welcomeCaption', 'afterHoursNotice', 'bookingMode', 'appointmentCodePrefix', 'reminders', 'followUps'],
    tryMessage: 'hola',
    body: [
      h('div', { class: 'grid-3' }, field('Nombre de la asistente', botName), field('Tono', tone), field('Emojis', emojis)),
      field('Mensaje de bienvenida (primer contacto)', welcome, 'Va con el logo y el aviso de privacidad.'),
      field('Aviso nocturno (clínica cerrada)', night, 'Vacío = texto por defecto.'),
      h('p', { class: 'field' }, h('span', {}, 'Vista previa')), preview,
      h('div', { class: 'grid-2' },
        field('Cómo se agendan las citas', bookingMode, 'En "solicitud" el paciente recibe "solicitud recibida" y recepción confirma.'),
        field('Prefijo del código de cita', codePrefix, '2 a 4 letras mayúsculas (ej. DV → DV-0472).')),
      bookingWarning, passPreview,
      h('div', { class: 'grid-2' },
        field('Primer recordatorio (horas antes)', firstReminder, 'De 12 a 96 h; 0 = no enviarlo. Por defecto 48 h.'),
        field('Segundo recordatorio (horas antes)', secondReminder, 'De 1 a 6 h; 0 = no enviarlo. Por defecto 2 h.')),
      h('label', { class: 'field field--check' }, followEnabled, h('span', {}, 'Seguimiento cuando el paciente no responde (máximo 3; se detiene si dice "no", agenda, pasa a humano o es menor de edad)')),
      h('div', { class: 'grid-3' },
        field('1.º (horas)', followFirst, 'Con 2 horarios en botones.'),
        field('2.º (horas)', followSecond, 'Responde la duda más probable.'),
        field('3.º (días)', followDays, 'Plantilla; solo con permiso de promociones.')),
    ],
    collect: () => ({
      botName: botName.value.trim(), tone: tone.value, emojiLevel: emojis.value,
      welcomeCaption: welcome.value.trim(), ...(night.value.trim() ? { afterHoursNotice: night.value.trim() } : {}),
      bookingMode: bookingMode.value,
      ...(codePrefix.value.trim() ? { appointmentCodePrefix: codePrefix.value.trim().toUpperCase() } : {}),
      reminders: { firstHours: hoursOrNull(firstReminder), secondHours: hoursOrNull(secondReminder) },
      followUps: {
        enabled: followEnabled.checked, firstHours: Number(followFirst.value), secondHours: Number(followSecond.value), thirdDays: Number(followDays.value), max: 3,
      },
    }),
  });
}
