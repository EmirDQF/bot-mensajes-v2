// Conexión en vivo (Server-Sent Events) con reconexión y respaldo por consultas periódicas.
// Render puede cortar conexiones largas: EventSource reconecta solo y manda el último id recibido,
// el servidor repone lo perdido; si no puede ("resync") o si el stream falla varias veces seguidas,
// el panel vuelve a pedir los datos a la API.

const TYPES = ['message', 'status', 'typing', 'bot', 'handoff', 'appointment', 'conversation', 'settings', 'tester', 'alert'];
const BACKOFF_MS = [1000, 2000, 5000, 10000, 30000];
const POLL_MS = 5000;

export function connectLive({ onEvent, onStatus, onResync }) {
  let source = null;
  let lastId = null;
  let failures = 0;
  let everReady = false;
  let retryTimer = null;
  let pollTimer = null;
  let stopped = false;

  const setStatus = (status) => onStatus?.(status);

  function startPolling() {
    if (pollTimer) return;
    setStatus('polling');
    pollTimer = setInterval(() => onResync?.('poll'), POLL_MS);
  }

  function stopPolling() {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  function open() {
    if (stopped) return;
    const query = lastId ? `?lastEventId=${encodeURIComponent(lastId)}` : '';
    source = new EventSource(`/api/panel/stream${query}`);
    source.addEventListener('ready', () => {
      const reconnected = everReady;
      everReady = true;
      failures = 0;
      stopPolling();
      setStatus('live');
      if (reconnected) onResync?.('reconnect');
    });
    source.addEventListener('resync', () => onResync?.('resync'));
    for (const type of TYPES) {
      source.addEventListener(type, (event) => {
        if (event.lastEventId) lastId = event.lastEventId;
        try {
          onEvent?.(type, JSON.parse(event.data));
        } catch (error) {
          console.warn('Evento en vivo inválido', error);
        }
      });
    }
    source.onerror = () => {
      failures += 1;
      setStatus(failures > 2 ? 'polling' : 'reconnecting');
      if (failures > 2) startPolling();
      // CLOSED: el navegador no reintentará (p. ej. sesión vencida o servidor reiniciando): se reintenta con espera.
      if (source.readyState === EventSource.CLOSED) {
        source.close();
        clearTimeout(retryTimer);
        retryTimer = setTimeout(open, BACKOFF_MS[Math.min(failures - 1, BACKOFF_MS.length - 1)]);
      }
    };
  }

  open();
  return {
    close() {
      stopped = true;
      source?.close();
      clearTimeout(retryTimer);
      stopPolling();
    },
  };
}

export default connectLive;
