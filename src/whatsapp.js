import qrcode from 'qrcode-terminal';
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  delay,
} from '@whiskeysockets/baileys';
import { obtenerRespuestaIA } from './gemini.js';

const authFolder = process.env.AUTH_INFO_DIR || './auth_info';
const colors = {
  reset: '\x1b[0m',
  blue: '\x1b[34m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
};
const contingencyMessage = 'En este momento nuestro sistema está ocupado, un asesor te responderá a la brevedad.';
const adminPhoneRaw = process.env.ADMIN_WHATSAPP_NUMBER?.trim();

function buildAdminJid(rawNumber) {
  if (!rawNumber) return null;
  const clean = rawNumber.trim();
  if (clean.endsWith('@s.whatsapp.net')) {
    return clean;
  }
  const digits = clean.replace(/\D/g, '');
  return digits ? `${digits}@s.whatsapp.net` : null;
}

// Notifica al administrador por WhatsApp cuando un paciente queda listo para agendar
// (envío encapsulado en try/catch para no afectar la respuesta al paciente)
// Notifica al administrador vía WhatsApp con un resumen del paciente agendado para que el equipo humano lo atienda.
async function notifyAdmin(sock, lead) {
  const adminJid = buildAdminJid(adminPhoneRaw);
  if (!adminJid) {
    console.warn('ADMIN_WHATSAPP_NUMBER no está configurado. No se envió la notificación al administrador.');
    return;
  }

  const fechaDisplay = lead.fechaHoraISO ? new Date(lead.fechaHoraISO).toLocaleString('es-PE', { timeZone: 'America/Lima', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : (lead.fechaHoraTexto || 'N/A');
  const alertMessage = `🚨 ¡NUEVO PACIENTE AGENDADO!\n👤 Nombre: ${lead.nombre || 'N/A'}\n📞 Teléfono: ${lead.telefono || lead.telefonoOriginal || 'N/A'}\n📍 Distrito: ${lead.distrito || 'N/A'}\n🗓️ Fecha/Hora: ${fechaDisplay}`;

  try {
    await sock.sendMessage(adminJid, { text: alertMessage });
    console.log(`${colors.green}✅ Notificación enviada al administrador: ${adminJid}${colors.reset}`);
  } catch (error) {
    // Loguear el error sin interrumpir la interacción con el paciente
    console.error(`${colors.red}❌ Error al enviar notificación al administrador:${colors.reset}`, error);
  }
}

function getMessageText(message) {
  if (!message) return null;
  if ('conversation' in message && message.conversation) {
    return message.conversation.trim();
  }

  if ('extendedTextMessage' in message && message.extendedTextMessage?.text) {
    return message.extendedTextMessage.text.trim();
  }

  if ('imageMessage' in message && message.imageMessage?.caption) {
    return message.imageMessage.caption.trim();
  }

  if ('videoMessage' in message && message.videoMessage?.caption) {
    return message.videoMessage.caption.trim();
  }

  return null;
}

function getRandomDelayMs() {
  return 2000 + Math.floor(Math.random() * 2000);
}

export default async function iniciarWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(authFolder);
  const versionResult = await fetchLatestBaileysVersion().catch((error) => {
    console.warn(`${colors.yellow}No se pudo obtener la versión más reciente de Baileys:${colors.reset}`, error?.message || error);
    return { version: [2, 3000, 1035194821] };
  });

  const sock = makeWASocket({
    auth: state,
    version: versionResult.version,
    printQRInTerminal: false,
    browser: ['BotMensajes', 'Chrome', '1.0.0'],
    syncFullHistory: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      qrcode.generate(qr, { small: true });
      console.log(`${colors.yellow}📱 Escanea el código QR para iniciar sesión.${colors.reset}`);
    }

    if (connection) {
      console.log(`${colors.blue}🔗 Estado de conexión: ${connection}${colors.reset}`);
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode || lastDisconnect?.error?.statusCode;
      if (statusCode === DisconnectReason.loggedOut) {
        console.warn(`${colors.red}⚠️ La sesión fue desconectada permanentemente. Borra la carpeta auth_info y reinicia el bot para volver a escanear el QR.${colors.reset}`);
      } else {
        console.warn(`${colors.yellow}⚠️ Conexión cerrada. Baileys intentará reconectar automáticamente si la sesión sigue válida.${colors.reset}`);
      }
    }
  });

  sock.ev.on('messages.upsert', async (upsert) => {
    if (upsert.type !== 'notify') return;

    for (const message of upsert.messages) {
      const remoteJid = message.key?.remoteJid;
      if (!remoteJid) continue;
      if (remoteJid.endsWith('@g.us')) continue;
      if (remoteJid === 'status@broadcast') continue;
      if (message.key.fromMe) continue;

      const texto = getMessageText(message.message);
      if (!texto) continue;

      console.log(`${colors.blue}📩 Mensaje de [${remoteJid}]: "${texto}"${colors.reset}`);

      try {
        await sock.presenceSubscribe(remoteJid);
        await sock.sendPresenceUpdate('composing', remoteJid);
        await delay(getRandomDelayMs());
       
        const { texto: respuesta, leadResult } = await obtenerRespuestaIA(remoteJid, texto);
        await sock.sendMessage(remoteJid, { text: respuesta });
        console.log(`${colors.green}🤖 Respuesta de IA enviada a [${remoteJid}]: "${respuesta}"${colors.reset}`);

        // Notificar al administrador solo cuando el lead está listo para agendar (fecha, nombre y distrito completos)
        if (leadResult?.readyToNotify && leadResult.lead) {
          // Enviar confirmación al paciente antes de notificar al admin
          try {
            const lead = leadResult.lead;
            let confirmMsg = '';
            if (lead.fechaHoraConfirmada && lead.fechaHoraISO) {
              const fecha = new Date(lead.fechaHoraISO);
              const fechaStr = fecha.toLocaleString('es-PE', { timeZone: 'America/Lima', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
              confirmMsg = `¡Perfecto ${lead.nombre || ''}! Quedaste agendado para el ${fechaStr} en ${lead.distrito || 'N/A'}. Te confirmaremos por este medio. 😊`;
            } else {
              const fechaText = lead.fechaHoraTexto || 'la fecha indicada';
              confirmMsg = `Gracias ${lead.nombre || ''}. He registrado tu solicitud para ${fechaText} en ${lead.distrito || 'N/A'}. ¿Puedes confirmar que esa fecha y hora te viene bien?`;
            }

            await sock.sendMessage(remoteJid, { text: confirmMsg });
            console.log(`${colors.green}✅ Mensaje de confirmación enviado a [${remoteJid}]: "${confirmMsg}"${colors.reset}`);
          } catch (err) {
            console.warn('No se pudo enviar confirmación al paciente:', err);
          }

          await notifyAdmin(sock, leadResult.lead);
        }
      } catch (error) {
        console.error(`${colors.red}❌ Error al procesar el mensaje entrante:${colors.reset}`, error);
        try {
          await sock.sendMessage(remoteJid, { text: contingencyMessage });
        } catch (sendError) {
          console.error(`${colors.red}❌ No se pudo enviar el mensaje de contingencia:${colors.reset}`, sendError);
        }
      }
    }
  });

  console.log(`${colors.green}✅ Bot de WhatsApp iniciado. Esperando mensajes...${colors.reset}`);
}
