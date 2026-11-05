import { describe, it, afterEach } from 'node:test';
import assert from 'assert';

// Fase 1 (agente top): catálogo visual por tratamiento, tarjeta del pack de evaluación y lenguaje coloquial.

process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test';

const {
  default: clinic, BASE_CLINIC, validateClinic, findTreatment, findTreatments,
} = await import('../config/clinic.config.js');
const { expandColloquial } = await import('../config/colloquial.js');
const catalog = await import('./catalog.js');
const { packCardSvg, packCardPng, packCardUrl } = await import('./cards/packCard.js');
const { wrapText, esc } = await import('./cards/render.js');
const { extractPlainText, stripInstructionTags } = await import('./replyText.js');
const { quickAnswer } = await import('./quickAnswers.js');
const { buildSystemPrompt } = await import('./geminiService.js');
const { createApp } = await import('../app.js');
const { createMemoryDb } = await import('./demo/memoryDb.js');
const { useInMemorySupabase } = await import('./supabaseClient.js');
const { runInTestMode, TEST_PHONE_PREFIX } = await import('./testContext.js');
const { default: webhookController, waitForIdle } = await import('../controllers/webhookController.js');

const TODAY = '2026-11-04';
const withPack = (pack) => ({ ...structuredClone(BASE_CLINIC), evaluationPack: pack });
const PACK = {
  title: 'Evaluación digital 3D',
  includes: ['Radiografía panorámica', 'Escaneo intraoral 3D', 'Plan de tratamiento'],
  price: 50,
  promotion: { text: 'Precio de campaña', price: 0, validUntil: '2026-11-30' },
  bring: 'Solo trae tu DNI.',
};

describe('configuración: catálogo y pack de evaluación', () => {
  it('la clínica demo es válida con su catálogo y su pack', () => {
    assert.deepEqual(validateClinic(BASE_CLINIC), []);
    assert.ok(BASE_CLINIC.treatments.find((t) => t.key === 'ortodoncia').images.length >= 1);
    assert.ok(BASE_CLINIC.evaluationPack.includes.length >= 1);
  });

  it('rechaza imágenes con rutas peligrosas, formatos no permitidos o demasiadas imágenes', () => {
    const bad = (images) => {
      const c = structuredClone(BASE_CLINIC);
      c.treatments[0].images = images;
      return validateClinic(c).join(' | ');
    };
    assert.match(bad([{ file: '../../.env' }]), /images\[0\]\.file/);
    assert.match(bad([{ file: 'catalogo/foto.gif' }]), /images\[0\]\.file/);
    assert.match(bad([{ file: 'http://inseguro.com/a.png' }]), /images\[0\]\.file/);
    assert.match(bad(Array.from({ length: 7 }, () => ({ file: 'a.png' }))), /hasta 6/);
    assert.equal(bad([{ file: 'catalogo/a.webp', caption: 'ok' }, { file: 'https://x.supabase.co/storage/a.jpg' }]), '');
  });

  it('el pack exige título e incluye, y valida precio y fecha de la promoción', () => {
    assert.deepEqual(validateClinic(withPack(PACK)), []);
    assert.match(validateClinic(withPack({ ...PACK, title: '' })).join(), /evaluationPack\.title/);
    assert.match(validateClinic(withPack({ ...PACK, includes: [] })).join(), /evaluationPack\.includes/);
    assert.match(validateClinic(withPack({ ...PACK, price: '50' })).join(), /evaluationPack\.price/);
    assert.match(validateClinic(withPack({ ...PACK, promotion: { text: 'X', validUntil: '30/11/2026' } })).join(), /validUntil/);
    assert.deepEqual(validateClinic(withPack(undefined)), []);
  });
});

describe('pack de evaluación: solo datos de la configuración', () => {
  it('muestra qué incluye, el precio regular tachado y la promoción vigente con su fecha de fin', () => {
    const text = catalog.evaluationPackText(withPack(PACK), TODAY);
    for (const item of PACK.includes) assert.ok(text.includes(item));
    assert.match(text, /~S\/ 50~ \*Sin costo\* · Precio de campaña \(hasta el .*30 de noviembre\)/);
    assert.match(text, /Solo trae tu DNI/);
  });

  it('al vencer la promoción deja de mencionarla y muestra el precio normal', () => {
    const text = catalog.evaluationPackText(withPack(PACK), '2026-12-01');
    assert.doesNotMatch(text, /campaña|Sin costo/);
    assert.match(text, /💰 S\/ 50/);
    assert.doesNotMatch(catalog.evaluationPackPrompt(withPack(PACK), '2026-12-01'), /campaña/);
  });

  it('sin precio configurado no inventa uno; sin pack no envía nada', () => {
    const { price, promotion, ...noPrice } = PACK;
    assert.doesNotMatch(catalog.evaluationPackText(withPack(noPrice), TODAY), /S\/|💰/);
    assert.equal(catalog.evaluationPackText(withPack(undefined), TODAY), null);
    assert.equal(catalog.evaluationPackPrompt(withPack(undefined), TODAY), '');
    assert.equal(packCardSvg(withPack(undefined), TODAY), null);
    assert.equal(packCardUrl(withPack(undefined), TODAY), null);
  });

  it('precio 0 se muestra como "Sin costo"', () => {
    assert.match(catalog.evaluationPackText(withPack({ ...PACK, price: 0, promotion: undefined }), TODAY), /💰 Sin costo/);
  });

  it('el prompt de Gemini trae el pack (para que no invente) y avisa que las imágenes las envía el sistema', () => {
    const prompt = buildSystemPrompt(withPack(PACK), { today: TODAY });
    assert.match(prompt, /Pack de primera visita "Evaluación digital 3D": incluye Radiografía panorámica/);
    assert.match(prompt, /nunca digas que no puedes enviar fotos/);
  });

  it('la tarjeta PNG se genera con los datos de la clínica, escapa el texto y cambia de URL si cambia el pack', () => {
    const svg = packCardSvg(withPack({ ...PACK, title: 'Pack <Premium> & más' }), TODAY);
    assert.ok(svg.includes('Pack &lt;Premium&gt; &amp; más'));
    assert.ok(svg.includes('Radiografía panorámica'));
    const png = packCardPng(withPack(PACK), TODAY);
    assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
    assert.notEqual(packCardUrl(withPack(PACK), TODAY), packCardUrl(withPack({ ...PACK, price: 60 }), TODAY));
    assert.match(packCardUrl(withPack(PACK), TODAY), /\/cards\/evaluation-pack\.png\?v=[0-9a-f]{12}$/);
  });

  it('decide cuándo mostrar el pack', () => {
    assert.equal(catalog.wantsEvaluationPack('¿Qué necesito llevar y cuánto cuesta empezar?'), true);
    assert.equal(catalog.wantsEvaluationPack('quiero una cita'), true);
    assert.equal(catalog.wantsEvaluationPack('cuanto sale la evaluacion'), true);
    assert.equal(catalog.wantsEvaluationPack('gracias, nos vemos'), false);
  });
});

describe('catálogo visual por tratamiento', () => {
  it('devuelve las imágenes del catálogo con su texto y, si no tiene catálogo, la foto única', () => {
    const orto = catalog.treatmentImages('ortodoncia');
    assert.ok(orto.length >= 1);
    assert.match(orto[0].url, /\/media\/denvari\/catalogo\/.+\.png$/);
    assert.match(orto[0].caption, /Ortodoncia/);
    const limpieza = catalog.treatmentImages('limpieza');
    assert.equal(limpieza.length, 1);
    assert.match(limpieza[0].url, /\/media\/denvari\/limpieza\.png$/);
  });

  it('solo los tratamientos con catálogo se envían sin que pidan "fotos"; sin repetir URLs', () => {
    assert.deepEqual(catalog.catalogKeysForMessage('info de ortodoncia o carillas por favor'), ['ortodoncia', 'carillas']);
    assert.deepEqual(catalog.catalogKeysForMessage('cuánto cuesta la limpieza'), []);
    const items = catalog.imagesForKeys(['ortodoncia', 'ortodoncia', 'carillas']);
    assert.equal(new Set(items.map((i) => i.url)).size, items.length);
  });
});

describe('lenguaje coloquial y errores de tipeo (Perú)', () => {
  it('reconoce cómo llaman los pacientes a los tratamientos', () => {
    const cases = {
      frenillos: 'ortodoncia', 'precio de bravkets': 'ortodoncia', brakets: 'ortodoncia', 'fierritos pls': 'ortodoncia',
      'quiero sacarme una muela': 'extraccion', 'sacar muela': 'extraccion', 'un diente postizo': 'implantes',
      'dientes postizos cuanto': 'implantes', 'limpiza dental': 'limpieza', blanquiamiento: 'blanqueamiento', cariyas: 'carillas',
    };
    for (const [text, key] of Object.entries(cases)) assert.equal(findTreatment(text)?.key, key, text);
  });

  it('encuentra varios tratamientos en el mismo mensaje', () => {
    assert.deepEqual(findTreatments('brackets o carillas?').map((t) => t.key), ['ortodoncia', 'carillas']);
    assert.deepEqual(findTreatments('hola'), []);
  });

  it('normaliza "cuanto sale", "precio pls", "info" y "q" para detectar la intención', () => {
    assert.match(expandColloquial('cuanto sale la limpieza'), /cuanto cuesta/);
    assert.match(expandColloquial('a cuanto los brackets'), /cuanto cuesta/);
    assert.equal(expandColloquial('precio pls'), 'precio por favor');
    assert.equal(expandColloquial('info'), 'informacion');
    assert.equal(expandColloquial('q horario tienen'), 'que horario tienen');
  });

  it('sin IA, "cuanto sale la limpieza" recibe el precio configurado', () => {
    const answer = quickAnswer(expandColloquial('cuanto sale la limpieza'), { clinic, today: TODAY });
    assert.ok(answer.kinds.includes('precio'));
    assert.match(answer.text, /Limpieza dental \(profilaxis\): desde S\/ 80/);
  });
});

describe('textos auxiliares', () => {
  it('extractPlainText saca el texto de un JSON y deja el texto normal igual', () => {
    assert.equal(extractPlainText('{"respuesta": "Hola"}'), 'Hola');
    assert.equal(extractPlainText('```json\n{"texto": {"content": "Anidado"}}\n```'), 'Anidado');
    assert.equal(extractPlainText('Texto normal'), 'Texto normal');
    assert.equal(stripInstructionTags('Mira [ENVIAR_FOTO: ortodoncia] esto'), 'Mira esto');
  });

  it('wrapText corta sin partir palabras y esc evita inyectar SVG', () => {
    assert.deepEqual(wrapText('uno dos tres cuatro', 8), ['uno dos', 'tres', 'cuatro']);
    assert.equal(wrapText('a b c d e f g', 1, 2).length, 2);
    assert.equal(esc('<script>"x"</script>'), '&lt;script&gt;&quot;x&quot;&lt;/script&gt;');
  });
});

describe('GET /cards/evaluation-pack.png', () => {
  it('la bandeja y el Probador muestran la tarjeta desde el mismo servidor', async () => {
    const { panelMediaUrl } = await import('./inboxService.js');
    assert.equal(panelMediaUrl({ media_url: 'http://localhost:3000/cards/evaluation-pack.png?v=abc' }), '/cards/evaluation-pack.png?v=abc');
    assert.equal(panelMediaUrl({ media_url: 'javascript:alert(1)' }), null);
  });

  it('sirve la tarjeta como PNG', async () => {
    const app = createApp({ getSupabase: () => null });
    const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/cards/evaluation-pack.png?v=1`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-type'), 'image/png');
      const bytes = new Uint8Array(await res.arrayBuffer());
      assert.deepEqual([...bytes.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
    } finally {
      server.close();
    }
  });
});

describe('webhook: catálogo y pack en la conversación', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; useInMemorySupabase(null); });
  const metaMessage = (phone, text) => ({ id: `wamid.cat.${phone}.${Math.random().toString(36).slice(2)}`, from: phone, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text } });
  const stubGemini = (text) => {
    globalThis.fetch = async (url, options) => (String(url).includes('generativelanguage.googleapis.com')
      ? new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }] }), { status: 200 })
      : realFetch(url, options));
  };
  async function send(phone, text, sent) {
    await runInTestMode({ onSend: (to, payload) => sent.push({ to, ...payload }) }, async () => {
      await webhookController({ body: { entry: [{ changes: [{ value: { messages: [metaMessage(phone, text)] } }] }] } }, { status() { return this; }, send() { return this; } });
      await waitForIdle(phone);
    });
  }

  it('envía el catálogo de cada tratamiento que pregunta, antes del texto, y no lo repite', async () => {
    useInMemorySupabase(createMemoryDb());
    stubGemini('¡Claro! ¿Cuál de los dos te llama más la atención?');
    const phone = `${TEST_PHONE_PREFIX}8101`;
    const sent = [];
    await send(phone, 'hola', sent);
    sent.length = 0;
    await send(phone, 'Quiero mejorar mi sonrisa, ¿me dan info de ortodoncia o carillas por favor?', sent);
    const toPatient = sent.filter((m) => m.to === phone);
    const catalogUrls = toPatient.filter((m) => /\/catalogo\//.test(m.media || '')).map((m) => m.media);
    assert.equal(catalogUrls.length, 2);
    assert.match(catalogUrls[0], /ortodoncia/);
    assert.match(catalogUrls[1], /carillas/);
    const textIndex = toPatient.findIndex((m) => !m.media && /te llama más/.test(m.text));
    assert.ok(textIndex > toPatient.findIndex((m) => /carillas/.test(m.media || '')), 'el texto va después del catálogo');
    assert.match(toPatient.find((m) => /ortodoncia/.test(m.media || '')).text, /Ortodoncia/);

    sent.length = 0;
    await send(phone, 'y los brackets de zafiro cuánto?', sent);
    assert.equal(sent.filter((m) => /\/catalogo\//.test(m.media || '')).length, 0, 'no repite el catálogo');
  });

  it('con Gemini caído igual envía el catálogo y la tarjeta (son datos de la configuración)', async () => {
    useInMemorySupabase(createMemoryDb());
    globalThis.fetch = async (url, options) => (String(url).includes('generativelanguage.googleapis.com')
      ? new Response('{"error":{"code":503}}', { status: 503 })
      : realFetch(url, options));
    const phone = `${TEST_PHONE_PREFIX}8103`;
    const sent = [];
    await send(phone, 'hola', sent);
    sent.length = 0;
    await send(phone, 'cuanto sale la evaluacion de brackets?', sent);
    const media = sent.filter((m) => m.to === phone).map((m) => m.media || '');
    assert.ok(media.some((u) => /catalogo\/ortodoncia/.test(u)));
    assert.ok(media.some((u) => /evaluation-pack/.test(u)));
    assert.ok(sent.some((m) => m.to === phone && !m.media && /1[.,]?800/.test(m.text)), 'responde el precio sin IA');
  });

  it('envía la tarjeta del pack una sola vez cuando pregunta requisitos o cómo agendar', async () => {
    useInMemorySupabase(createMemoryDb());
    stubGemini('Solo necesitas tu DNI. ¿Qué horario te acomoda?');
    const phone = `${TEST_PHONE_PREFIX}8102`;
    const sent = [];
    await send(phone, 'hola', sent);
    sent.length = 0;
    await send(phone, '¿Qué necesito llevar, cuánto cuesta empezar y cómo agendo?', sent);
    const cards = sent.filter((m) => m.to === phone && /\/cards\/evaluation-pack\.png/.test(m.media || ''));
    assert.equal(cards.length, 1);
    assert.match(cards[0].text, /Radiografía panorámica/);
    assert.match(cards[0].text, /Solo trae tu DNI/);

    sent.length = 0;
    await send(phone, 'quiero agendar una cita', sent);
    assert.equal(sent.filter((m) => /evaluation-pack/.test(m.media || '')).length, 0, 'no repite la tarjeta');
  });
});
