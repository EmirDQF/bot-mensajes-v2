// Forward webhook/payload data to the external dashboard (non-blocking)
export async function forwardToDashboard(payload) {
  try {
    const dashboardBase = (process.env.PANEL_BACKEND_URL || 'https://whatsapp-dashboard-z9jm.onrender.com').replace(/\/+$/, '');
    let body = payload;

    // Normalize Buffer/raw bodies into JS object when possible
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(payload)) {
      try {
        body = JSON.parse(payload.toString('utf8'));
      } catch (e) {
        body = { raw: payload.toString('utf8') };
      }
    }

    // If this looks like an outgoing message, call the bot-reply endpoint with normalized shape
    const isOutgoing = body && (body.direction === 'outgoing' || body.outgoing);
    if (isOutgoing) {
      try {
        const out = body.outgoing || {};
        const phoneRaw = out.to || out.phone || out.toPhone || out.toPhoneNumber || out.recipient || null;
        const phone = phoneRaw ? String(phoneRaw).replace(/\D/g, '') : null;
        const text = out.text || out.body || out.caption || null;
        const mediaUrl = out.mediaUrl || out.media_url || out.imageUrl || null;

        if (phone) {
          const url = `${dashboardBase}/api/bot-reply`;
          // Fire-and-forget POST
          fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, text: text || '', mediaUrl: mediaUrl || null, fromMe: true })
          }).catch((err) => {
            console.warn('forwardToDashboard: /api/bot-reply failed:', err && err.message ? err.message : err);
          });
          return;
        }
      } catch (e) {
        console.warn('forwardToDashboard: failed preparing outgoing payload:', e && e.message ? e.message : e);
      }
    }

    // Forward incoming WhatsApp payloads to the dashboard webhook.
    try {
      const url = `${dashboardBase}/webhook`;
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }).catch((err) => {
        console.warn('forwardToDashboard: /api/webhook failed:', err && err.message ? err.message : err);
      });
    } catch (e) {
      // Non-blocking
      console.warn('forwardToDashboard: fallback post failed:', e && e.message ? e.message : e);
    }
  } catch (err) {
    // Defensive logging only
    try { console.warn('forwardToDashboard failed (non-blocking):', err && err.message ? err.message : err); } catch (e) {}
  }
}

export default forwardToDashboard;
