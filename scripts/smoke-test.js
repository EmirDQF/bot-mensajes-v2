import fs from 'fs/promises';
import path from 'path';

async function run() {
  console.log('Running smoke test...');
  // Override leads file for testing BEFORE loading modules
  process.env.LEADS_TEST_FILE = 'leads.test.json';
  const testFile = path.resolve(process.cwd(), 'leads.test.json');
  try { await fs.rm(testFile); } catch(e) {}

  // Import modules dynamically so they pick up LEADS_TEST_FILE
  const { hasSchedulingIntent, extractLeadData, parseFechaHora } = await import('../src/gemini.js');
  const { saveLead } = await import('../src/leads.js');
  // Also import webhook processor to simulate Cloud API payload
  const { processWebhookEvent } = await import('../src/whatsapp.js');

  const messages = [
    'hola',
    'cuánto cuesta el inicial de brackets',
    'quiero agendar, me llamo Juan Perez, mi numero es 987654321, vivo en San Borja, puedo el jueves a las 3pm'
  ];

  const history = [];
  let detectedIntent = false;
  let extracted = null;
  let leadResult = null;

  for (const msg of messages) {
    history.push({ role: 'user', parts: [{ text: msg }] });
    if (!detectedIntent && hasSchedulingIntent(msg, history)) {
      detectedIntent = true;
      console.log('PASS: scheduling intent detected');
    }
  }

  if (!detectedIntent) console.log('FAIL: scheduling intent not detected');

  extracted = await extractLeadData(history);
  if (extracted && extracted.nombre && extracted.telefono && extracted.distrito && extracted.fechaHora) {
    console.log('PASS: extracted all fields from conversation');
  } else {
    console.log('FAIL: extraction incomplete', extracted);
  }

  // Parse fechaHora
  const parsed = parseFechaHora(extracted?.fechaHora || '');
  if (parsed) console.log('PASS: fechaHora parsed ->', parsed.toISOString());
  else console.log('FAIL: fechaHora could not be parsed');

  // Save lead (uses LEADS_TEST_FILE)
  leadResult = await saveLead({ telefono: extracted.telefono, nombre: extracted.nombre, distrito: extracted.distrito, fechaHoraTexto: extracted.fechaHora, fechaHoraISO: parsed ? parsed.toISOString() : null, fechaHoraConfirmada: Boolean(parsed) });
  if (leadResult && leadResult.lead) {
    console.log('PASS: lead saved to test file:', leadResult.lead);
  } else {
    console.log('FAIL: lead not saved');
  }

  // Verify leads.test.json exists
  try {
    const raw = await fs.readFile(testFile, 'utf8');
    const parsedFile = JSON.parse(raw);
    if (Array.isArray(parsedFile) && parsedFile.length > 0) console.log('PASS: leads.test.json created with entries');
    else console.log('FAIL: leads.test.json empty');
  } catch (e) {
    console.log('FAIL: leads.test.json not found', e.message);
  }

  // Simulate a webhook payload from Meta Cloud API to validate parser/handler
  const fakePayload = {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'fake-entry',
        changes: [
          {
            value: {
              messaging_product: 'whatsapp',
              metadata: { phone_number_id: '12345' },
              contacts: [{ profile: { name: 'Juan Perez' }, wa_id: '51987654321' }],
              messages: [
                { from: '51987654321', id: 'msg1', timestamp: `${Math.floor(Date.now()/1000)}`, text: { body: 'Quiero agendar, me llamo Juan Perez, mi numero es 987654321, vivo en San Borja, puedo el jueves a las 3pm' }, type: 'text' }
              ]
            }
          }
        ]
      }
    ]
  };

  // Call the webhook handler using null signature/headers (processWebhookEvent will skip signature verification if WHATSAPP_APP_SECRET not set)
  try {
    const webhookResult = await processWebhookEvent(fakePayload, Buffer.from(JSON.stringify(fakePayload)), {});
    console.log('Webhook simulation result:', webhookResult);
  } catch (e) {
    console.error('Webhook simulation failed:', e);
  }
}

run().catch((e) => { console.error('Smoke test error', e); process.exit(1); });