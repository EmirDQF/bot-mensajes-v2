import express from 'express';
process.env.NODE_ENV = 'production';
process.env.GEMINI_API_KEY='test';
process.env.GEMINI_MODEL='gemini-3.5-flash-lite';
process.env.WHATSAPP_PHONE_NUMBER_ID='12345';
process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN='verify-token';
// Intentionally do NOT set WHATSAPP_APP_SECRET
const makeVerify = (await import('./middleware/verifySignature.js')).default;
const app = express();
app.use(express.raw({ type: 'application/json' }));
app.post('/test', makeVerify(), (req, res) => res.json({ ok: true }));
const server = app.listen(0, async () => {
  const port = server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}/test`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
  console.log('status', res.status, await res.text());
  server.close();
});
