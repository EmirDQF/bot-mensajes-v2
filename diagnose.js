import { once } from 'node:events';
import express from 'express';
import { Agent as HttpAgent } from 'node:http';
import crypto from 'node:crypto';
import util from 'util';
process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || 'verify-token';
process.env.WHATSAPP_APP_SECRET = process.env.WHATSAPP_APP_SECRET || 'testsecret';
process.env.WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '12345';
process.env.ADMIN_WHATSAPP_NUMBER = process.env.ADMIN_WHATSAPP_NUMBER || '51987654321';
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-key';
process.env.GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
const { default: webhookRouter } = await import('./routes/webhook.js');
const { default: whatsappService } = await import('./services/whatsappService.js');
const { default: errorHandler } = await import('./middleware/errorHandler.js');
whatsappService.sendWhatsAppMessage = async () => ({ ok: true });
const app = express();
app.use('/', webhookRouter);
app.use(errorHandler);
const sockets = new Set();
const server = app.listen(0);
server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
await once(server, 'listening');
const address = server.address();
const port = address.port;
const httpAgent = new HttpAgent({ keepAlive: false });
const fakePayload = { object:'whatsapp_business_account', entry:[{ id:'fake-entry', changes:[{ value:{ messaging_product:'whatsapp', metadata:{ phone_number_id: process.env.WHATSAPP_PHONE_NUMBER_ID }, contacts:[{ profile:{ name:'Juan Perez' }, wa_id:'51987654321'}], messages:[{ from:'51987654321', id:'msg1', timestamp:`${Math.floor(Date.now()/1000)}`, text:{ body:'hello' }, type:'text'}]}}]}]};
const rawBody = JSON.stringify(fakePayload);
const signature = 'sha256=' + crypto.createHmac('sha256', process.env.WHATSAPP_APP_SECRET).update(rawBody).digest('hex');
const resp = await fetch(`http://127.0.0.1:${port}/webhook`, { method:'POST', headers:{'Content-Type':'application/json','X-Hub-Signature-256':signature, Connection:'close'}, agent: httpAgent, body: rawBody});
console.log('status', resp.status, await resp.text());
function otherHandles() {
  return process._getActiveHandles().filter(h => !((h.constructor && h.constructor.name === 'Socket') && [0,1,2].includes(h.fd)) && !(h.constructor && h.constructor.name === 'Server')).map((h, i) => ({ idx:i, name: h.constructor.name, fd: h.fd, type: h.type, localAddress: h.localAddress, localPort: h.localPort }));
}
console.log('other handles before cleanup', otherHandles());
for (const socket of sockets) { try { socket.destroy(); } catch(e) {} }
await new Promise((resolve, reject)=>server.close(err=>err?reject(err):resolve()));
httpAgent.destroy();
console.log('other handles after cleanup', otherHandles());
