const chatAuditLog = globalThis.chatAuditLog || (globalThis.chatAuditLog = []);
globalThis.chatAuditLog = chatAuditLog;

export function getChatAuditLog() {
  if (!globalThis.chatAuditLog || !Array.isArray(globalThis.chatAuditLog)) {
    globalThis.chatAuditLog = [];
  }
  return globalThis.chatAuditLog;
}

export function appendChatAuditEntry(entry) {
  try {
    const log = getChatAuditLog();
    if (!entry || typeof entry !== 'object') return;

    const phone = String(entry.phone || '').trim();
    const userMessage = String(entry.userMessage ?? '').trim();
    const botReply = String(entry.botReply ?? '').trim();
    if (!phone && !userMessage && !botReply) {
      return;
    }

    const normalized = {
      name: String(entry.name || 'Paciente').trim() || 'Paciente',
      phone,
      userMessage,
      botReply,
      timestamp: entry.timestamp || new Intl.DateTimeFormat('es-PE', { hour: '2-digit', minute: '2-digit' }).format(new Date()),
      imageAttachment: entry.imageAttachment || null,
    };

    log.unshift(normalized);
    while (log.length > 40) {
      log.pop();
    }
  } catch (error) {
    console.warn('[AUDIT LOG] No se pudo guardar la interacción:', error && error.message ? error.message : error);
  }
}

export default chatAuditLog;
