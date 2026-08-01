export default function errorHandler(err, req, res, next) {
  // Log full error internally with timestamp (do NOT leak stack to clients)
  try {
    const now = new Date().toISOString();
    const meta = {
      time: now,
      path: req?.originalUrl || req?.url || '<unknown>',
      method: req?.method || '<unknown>',
    };
    // Log error message and stack for internal inspection
    console.error('ERROR_HANDLER:', JSON.stringify(meta), err && err.stack ? err.stack : (err && err.message) || err);
  } catch (loggingErr) {
    // Best-effort logging; don't throw from the error handler
    console.error('ERROR_HANDLER: failed to log error', loggingErr);
  }

  // Send a safe response to the client
  const status = (err && err.status && Number(err.status)) || 500;
  const exposeMessage = err && err.expose === true;
  const message = exposeMessage ? String(err.message || 'Error') : 'Internal Server Error';

  // Do not include stack traces or sensitive details in the response
  res.status(status).json({ error: message });
}
