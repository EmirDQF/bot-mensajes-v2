import { describe, it } from 'node:test';
import assert from 'assert';

// Parte 1 (paridad con el video de referencia): textos en bloques, confirmación, ficha del doctor e imágenes.
// Todo con datos de la configuración: nada inventado.

process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test';

const { BASE_CLINIC } = await import('../config/clinic.config.js');
const { asksFirstVisit, firstVisitText, packShortCaption } = await import('./firstVisitReply.js');
const { confirmedBookingText } = await import('../controllers/bookingReplies.js');
const { doctorCardText } = await import('./doctorAlert.js');
const { appointmentPassSvg } = await import('./cards/appointmentPass.js');
const { packCardSvg } = await import('./cards/packCard.js');
const { catalogArtFor } = await import('./cards/catalogArt.js');
const { extractLeadDataFromText, CLAIMS_BOOKED } = await import('./geminiService.js');

const TODAY = '2026-11-04';
const clinic = () => structuredClone(BASE_CLINIC);
const SLOTS = [
  { date: '2026-11-05', time: '11:00', label: 'jueves, 5 de noviembre a las 11:00 a. m.' },
  { date: '2026-11-05', time: '16:30', label: 'jueves, 5 de noviembre a las 4:30 p. m.' },
  { date: '2026-11-07', time: '10:00', label: 'sábado, 7 de noviembre a las 10:00 a. m.' },
];
const APT = {
  id: 'a1', code: 'DV-0472', status: 'confirmada', confirmed_by: 'bot', patient_name: 'Carlos Mendoza', treatment: 'Evaluación',
  appointment_date: '2026-11-05', appointment_time: '16:30', specialist: 'Dra. Prueba', sender_phone: '51987654321',
};

describe('mensaje de la primera visita en bloques (📋 💰 📅)', () => {
  it('detecta la pregunta del video', () => {
    assert.equal(asksFirstVisit('¿Qué necesito, qué días tienen espacio, cuánto cuesta empezar y cómo agendo?'), true);
    assert.equal(asksFirstVisit('¿tengo que llevar radiografías o algo especial?'), true);
    assert.equal(asksFirstVisit('gracias, nos vemos'), false);
  });

  it('arma los 3 bloques con negritas de WhatsApp, solo con datos de la configuración y horarios reales', () => {
    const text = firstVisitText({ clinic: clinic(), today: TODAY, interestText: 'me interesan los brackets de zafiro y carillas', slots: SLOTS, firstName: 'Carlos' });
    assert.match(text, /^¡Excelente, Carlos!/);
    for (const block of ['📋 *¿Qué necesitas llevar?*', '💰 *Inversión y planes:*', '📅 *¿Cómo agendamos?*']) assert.ok(text.includes(block), block);
    assert.match(text, /Solo trae tu DNI/);
    assert.match(text, /~S\/ 50~ \*Sin costo\*/);
    assert.match(text, /Ortodoncia \(brackets metálicos y estéticos\): desde \*S\/ 1,800\*/);
    assert.match(text, /Carillas y diseño de sonrisa: desde \*S\/ 450\*/);
    assert.ok(text.includes('1️⃣ jueves, 5 de noviembre a las 11:00 a. m.'));
    assert.ok(text.includes('3️⃣ sábado, 7 de noviembre a las 10:00 a. m.'));
    // Ningún precio que no esté en la configuración (precios, pack o textos de financiamiento).
    const configText = JSON.stringify(clinic()).replace(/"priceFrom":(\d+)/g, (_, n) => `S/ ${Number(n).toLocaleString('es-PE')}`).replace(/"price":(\d+)/g, 'S/ $1');
    for (const [price] of text.matchAll(/S\/ [\d,]+/g)) assert.ok(configText.includes(price), price);
  });

  it('sin horarios o sin pack no arma nada; sin tratamientos no inventa líneas de precio', () => {
    assert.equal(firstVisitText({ clinic: clinic(), today: TODAY, slots: [] }), null);
    assert.equal(firstVisitText({ clinic: { ...clinic(), evaluationPack: undefined }, today: TODAY, slots: SLOTS }), null);
    const text = firstVisitText({ clinic: clinic(), today: TODAY, interestText: 'hola', slots: SLOTS });
    assert.doesNotMatch(text, /desde \*S\//);
  });

  it('promoción vencida: no se menciona', () => {
    const text = firstVisitText({ clinic: clinic(), today: '2027-01-15', slots: SLOTS });
    assert.doesNotMatch(text, /Precio de campaña|Sin costo/);
    assert.match(text, /\*S\/ 50\*/);
  });

  it('medios de pago solo si los pregunta y salen de la configuración', () => {
    assert.match(firstVisitText({ clinic: clinic(), today: TODAY, messageText: '¿aceptan yape?', slots: SLOTS }), /Medios de pago: Tarjetas de crédito y débito, Yape y Plin, Efectivo/);
    assert.doesNotMatch(firstVisitText({ clinic: clinic(), today: TODAY, messageText: '¿qué necesito?', slots: SLOTS }), /Medios de pago/);
  });

  it('el pie de la tarjeta del pack dice qué incluye', () => {
    assert.equal(packShortCaption(clinic(), TODAY), '🦷 *Evaluación digital 3D*: Radiografía panorámica, escaneo intraoral 3D y plan de tratamiento.');
  });
});

describe('confirmación y ficha con el formato del video', () => {
  it('confirmación: "100% confirmada", bloques en negrita y la línea de la ficha SOLO si se envió', () => {
    const sent = confirmedBookingText(APT, clinic(), { cardSentTo: 'doctor' });
    assert.match(sent, /¡Listo, Carlos! 🎉 Tu cita de evaluación ya quedó \*100% confirmada\*/);
    assert.ok(sent.includes('🦷 *Tratamiento:* Evaluación'));
    for (const part of ['🗓️ *Día:*', '👩‍⚕️ *Especialista:* Dra. Prueba', '📍 *Dirección:*', '🔖 *Código:* DV-0472', '🔔 *Para tu tranquilidad:*']) assert.ok(sent.includes(part), part);
    assert.match(sent, /ya le enviamos tu ficha a tu especialista/);
    assert.doesNotMatch(confirmedBookingText(APT, clinic()), /ficha/);
    assert.match(confirmedBookingText(APT, clinic(), { cardSentTo: 'recepcion' }), /ficha a recepción/);
    assert.doesNotMatch(sent, /solicitud/i);
  });

  it('ficha del doctor: encabezado de alerta y paciente, interés, cita y recordatorio (sin síntomas)', () => {
    const text = doctorCardText(APT, { interest: ['Ortodoncia', 'Carillas'], clinic: clinic() });
    assert.match(text, /^🟢 \*ALERTA AL DOCTOR — Nueva cita confirmada\*/);
    for (const part of ['👤 *Paciente:* Carlos Mendoza', '🦷 *Interés:* Ortodoncia + Carillas', '📅 *Cita:*', '🔔 *Recordatorio:* programado (48 h y 2 h antes)']) assert.ok(text.includes(part), part);
  });
});

describe('bienvenida con el nombre del perfil (como en el video)', () => {
  it('"¡Hola!" pasa a "¡Hola, Carlos!" solo si el nombre del perfil parece real', async () => {
    const { personalize } = await import('../controllers/firstContact.js');
    assert.equal(personalize('¡Hola! 👋 Bienvenido', 'Carlos Mendoza'), '¡Hola, Carlos! 👋 Bienvenido');
    assert.equal(personalize('¡Hola! 👋 Bienvenido', '🔥Tu crack🔥'), '¡Hola! 👋 Bienvenido');
    assert.equal(personalize('¡Hola! 👋 Bienvenido', null), '¡Hola! 👋 Bienvenido');
  });
});

describe('plantilla de la ficha del doctor (fuera de la ventana de 24 h)', () => {
  it('tiene el formato del video y el Probador muestra el texto final con las variables', async () => {
    const { renderTemplateBody, default: TEMPLATES } = await import('../config/whatsappTemplates.js');
    const params = TEMPLATES.doctorCard.example(clinic());
    assert.ok(params.every((p) => !/\n/.test(p)), 'las variables no llevan saltos de línea (Meta las rechaza)');
    const text = renderTemplateBody(TEMPLATES.doctorCard.name, params);
    assert.match(text, /^🟢 \*ALERTA AL DOCTOR — Nueva cita confirmada\*\n/);
    assert.match(text, /\n👤 \*Paciente:\* Ana Torres\n/);
    assert.doesNotMatch(text, /\{\{\d\}\}/);
    assert.equal(renderTemplateBody('no_existe', []), null);
  });
});

describe('agendar con la frase del video', () => {
  it('"Mi nombre completo es Carlos Mendoza" se reconoce como nombre', () => {
    assert.equal(extractLeadDataFromText('Mi nombre completo es Carlos Mendoza.').nombre, 'Carlos Mendoza');
    assert.equal(extractLeadDataFromText('Me queda perfecto el Jueves a las 4:30 p. m. Mi nombre completo es Carlos Mendoza.').nombre, 'Carlos Mendoza');
  });

  it('el modelo no puede decir que la solicitud quedó registrada si el sistema no la guardó', () => {
    assert.equal(CLAIMS_BOOKED.test('¡Listo, Carlos! Tu solicitud de cita para ortodoncia quedó registrada para el jueves'), true);
    assert.equal(CLAIMS_BOOKED.test('¿Te registro la solicitud para el jueves?'), false);
  });
});

describe('imágenes con calidad de diseño y datos reales', () => {
  it('pase de cita: colores de la clínica, recordatorio según la configuración, sin teléfono', () => {
    const c = { ...clinic(), colors: { primary: '#123456', accent: '#abcdef' } };
    const svg = appointmentPassSvg(APT, c);
    assert.ok(svg.includes('#123456') && svg.includes('#abcdef'));
    assert.ok(svg.includes('Recordatorio 48 h y 2 h antes: programado'));
    assert.ok(!svg.includes('987654321'));
    const off = appointmentPassSvg(APT, { ...c, reminders: { firstHours: null, secondHours: null } });
    assert.ok(!off.includes('Recordatorio'));
  });

  it('tarjeta del pack: título resaltado y precio de la configuración', () => {
    const svg = packCardSvg(clinic(), TODAY);
    assert.ok(svg.includes('<tspan fill="#14b8a6">3D</tspan>'));
    assert.ok(svg.includes('Sin costo') && svg.includes('S/ 50'));
  });

  it('catálogo: con los colores, el nombre y los precios "desde" de la clínica, marcado como referencial', () => {
    const c = { ...clinic(), name: 'Clínica Prospecto', colors: { primary: '#7c3aed', accent: '#f59e0b' } };
    const art = catalogArtFor(c);
    assert.deepEqual(art.map((a) => a.key), ['ortodoncia', 'carillas']);
    for (const item of art) {
      assert.ok(item.svg.includes('Clínica Prospecto'));
      assert.ok(item.svg.includes('#7c3aed') && item.svg.includes('#f59e0b'));
      assert.ok(item.svg.includes('Imagen referencial'));
      assert.match(item.caption, /referencial/i);
    }
    assert.ok(art[0].svg.includes('S/ 1,800'));
    // Sin precio en la configuración: la franja no inventa uno.
    const noPrice = { ...c, treatments: c.treatments.map((t) => (t.key === 'carillas' ? { ...t, priceFrom: undefined, financing: undefined } : t)) };
    assert.doesNotMatch(catalogArtFor(noPrice)[1].svg, /S\/ \d/);
    // Una clínica sin ortodoncia no recibe esa ilustración.
    assert.deepEqual(catalogArtFor({ ...c, treatments: c.treatments.filter((t) => t.key !== 'ortodoncia') }).map((a) => a.key), ['carillas']);
  });
});
