// Use the global fetch available in Node 18+ to avoid extra dependency


async function sendWebhookMessage(messageBody, from) {
  const payload = {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: process.env.WABA_ID || '1363917525928617',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { phone_number_id: process.env.WHATSAPP_PHONE_NUMBER_ID || '1337494962770981' },
              contacts: [{ profile: { name: from }, wa_id: from }],
              messages: [
                {
                  from,
                  id: `wamid.TEST_${Date.now()}`,
                  timestamp: `${Math.floor(Date.now() / 1000)}`,
                  text: { body: messageBody },
                  type: 'text'
                }
              ]
            }
          }
        ]
      }
    ]
  };

  try {
    const res = await fetch('http://localhost:3000/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const text = await res.text();
    return { status: res.status, body: text };
  } catch (err) {
    console.error('sendWebhookMessage error:', err && err.stack ? err.stack : err);
    throw err;
  }
}

(async function main() {
  try {
    console.log('Simulación: Enviando Mensaje 1 -> "Hola, buenos días"');
    const r1 = await sendWebhookMessage('Hola, buenos días', '51977123456');
    console.log('Respuesta Mensaje 1:', r1.status, r1.body);

    // esperar un segundo para simular conversación
    await new Promise((r) => setTimeout(r, 1000));

    console.log('Simulación: Enviando Mensaje 2 -> "Quiero agendar una cita dental para mañana a las 3:00 PM, mi nombre es Carlos Pérez"');
    const r2 = await sendWebhookMessage('Quiero agendar una cita dental para mañana a las 3:00 PM, mi nombre es Carlos Pérez', '51977123456');
    console.log('Respuesta Mensaje 2:', r2.status, r2.body);

    console.log('\nNotas de validación (manual):');
    console.log('- El servidor debe haber respondido HTTP 200 al instante para cada POST.');
    console.log('- Revisa los logs del servidor para ver el [WEBHOOK BODY] y el procesamiento asíncrono (IA -> Google Calendar -> Alertas).');
  } catch (e) {
    console.error('Error en la simulación:', e && e.message ? e.message : e);
  }
})();
