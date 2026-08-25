// Forward webhook/payload data to the external dashboard (non-blocking)
export async function forwardToDashboard(payload) {
  try {
    const url = 'https://whatsapp-dashboard-z9jm.onrender.com/api/webhook';
    let bodyToSend = payload;

    // If payload is a Buffer (express.raw body), try to parse as JSON, otherwise send as text
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(payload)) {
      try {
        bodyToSend = JSON.parse(payload.toString('utf8'));
      } catch (e) {
        // not JSON, send raw string
        bodyToSend = { raw: payload.toString('utf8') };
      }
    }

    // Ensure outgoing messages are marked as fromMe: true for dashboard sync
    try {
      if (bodyToSend && typeof bodyToSend === 'object' && bodyToSend.direction === 'outgoing') {
        bodyToSend.outgoing = Object.assign({}, bodyToSend.outgoing || {}, { fromMe: true });
      }
    } catch (e) {
      // ignore
    }

    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyToSend),
    });
  } catch (err) {
    // Non-blocking: log and continue
    try {
      console.warn('forwardToDashboard failed (non-blocking):', err && err.message ? err.message : err);
    } catch (e) {}
  }
}

export default forwardToDashboard;
