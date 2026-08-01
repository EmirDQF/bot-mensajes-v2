import { once } from 'node:events';
import express from 'express';
import crypto from 'crypto';
import { Agent as HttpAgent } from 'node:http';
process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || 'verify-token';
process.env.WHATSAPP_APP_SECRET = process.env.WHATSAPP_APP_SECRET || 'testsecret';
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-key';
process.env.GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
process.env.WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '12345';
process.env.WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || 'test-token';
process.env.ADMIN_WHATSAPP_NUMBER = process.env.ADMIN_WHATSAPP_NUMBER || '51987654321';

const { default: webhookRouter } = await import('./routes/webhook.js');
const { default: errorHandler } = await import('./middleware/errorHandler.js');
const whatsappModule = await import('./services/whatsappService.js');
// stub outbound WhatsApp to avoid creating TLSSocket
if (whatsappModule && whatsappModule.default) {
  whatsappModule.default.sendWhatsAppMessage = async () => ({ ok: true });
}

const app = express();
app.use('/', webhookRouter);
app.use(errorHandler);
const sockets = new Set();
const server = app.listen(0);
server.unref && server.unref();
server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
await once(server, 'listening');
const address = server.address();
const port = address.port;
const httpAgent = new HttpAgent({ keepAlive: false });
// Send a valid GET and POST
const challenge = 'test-challenge-42';
const challengeResp = await fetch(`http://127.0.0.1:${port}/webhook?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN)}&hub.challenge=${encodeURIComponent(challenge)}`, { agent: httpAgent});
console.log('GET /webhook response', challengeResp.status);
const fakePayload = { object:'whatsapp_business_account', entry:[{ id:'fake-entry', changes:[{ value:{ messaging_product:'whatsapp', metadata:{ phone_number_id: '123'}, contacts:[{ profile:{ name:'Juan' }, wa_id:'51987654321'}], messages:[{ from:'51987654321', id:'msg1', timestamp:`${Math.floor(Date.now()/1000)}`, text:{ body:'hi' }, type:'text'}]}}]}]};
const rawBody = JSON.stringify(fakePayload);
const signature = 'sha256=' + crypto.createHmac('sha256', process.env.WHATSAPP_APP_SECRET).update(rawBody).digest('hex');
const postResp = await fetch(`http://127.0.0.1:${port}/webhook`, { method:'POST', headers:{ 'Content-Type':'application/json', 'X-Hub-Signature-256':signature }, agent: httpAgent, body: rawBody });
console.log('POST /webhook response', postResp.status);
console.log('before close handles', process._getActiveHandles().length);
for(const h of process._getActiveHandles()) console.log('handle', h.constructor.name);
try { if (typeof server.closeAllConnections === 'function') server.closeAllConnections(); } catch(e) {}
for (const socket of sockets) try { socket.destroy(); } catch(e){}
await new Promise((resolve, reject)=> server.close(err=> err?reject(err):resolve()));
httpAgent.destroy();
console.log('after close handles', process._getActiveHandles().length);
for(const h of process._getActiveHandles()) console.log('handle2', h.constructor.name);
