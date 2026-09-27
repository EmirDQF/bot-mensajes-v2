import { EventEmitter } from 'events';
import crypto from 'crypto';

// Bus de eventos en memoria para la bandeja en vivo (GET /api/panel/stream).
// Lo alimentan los puntos que YA guardan datos (inboxService, handoffService, appointmentService):
// no escribe nada en la base de datos. Guarda los últimos eventos para que un navegador que se
// reconecta (Render corta conexiones largas) reciba lo que se perdió desde su último id.
//
// Ids "<arranque>-<secuencia>": si el servidor se reinició, el id del navegador no coincide con el
// arranque actual y se le pide volver a cargar (evento "resync").

export const EVENT_TYPES = ['message', 'status', 'typing', 'bot', 'handoff', 'appointment', 'conversation', 'settings'];

export function createLiveEvents({ bufferSize = 500, bootId = crypto.randomBytes(4).toString('hex') } = {}) {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(100);
  const buffer = [];
  let seq = 0;

  function publish(type, data = {}) {
    if (!EVENT_TYPES.includes(type)) throw new Error(`Evento desconocido: ${type}`);
    seq += 1;
    const event = { id: `${bootId}-${seq}`, seq, type, data, at: new Date().toISOString() };
    buffer.push(event);
    if (buffer.length > bufferSize) buffer.shift();
    emitter.emit('event', event);
    return event;
  }

  function subscribe(listener) {
    emitter.on('event', listener);
    return () => emitter.off('event', listener);
  }

  // Eventos posteriores a lastId. { events } si se pueden reponer; { resync: true } si hay un hueco.
  function since(lastId) {
    if (!lastId) return { events: [] };
    const [boot, rawSeq] = String(lastId).split('-');
    const lastSeq = Number(rawSeq);
    if (boot !== bootId || !Number.isInteger(lastSeq) || lastSeq > seq) return { resync: true, events: [] };
    const oldest = buffer[0]?.seq ?? seq + 1;
    if (lastSeq < oldest - 1) return { resync: true, events: [] };
    return { events: buffer.filter((e) => e.seq > lastSeq) };
  }

  return { publish, subscribe, since, bootId, listenerCount: () => emitter.listenerCount('event') };
}

const liveEvents = createLiveEvents();
export default liveEvents;
