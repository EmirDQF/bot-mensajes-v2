// Llamadas a /api/panel con la cookie de sesión (HttpOnly: el JavaScript nunca ve la contraseña).

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export async function api(path, { method = 'GET', body, headers = {}, raw = false } = {}) {
  const init = { method, credentials: 'same-origin', headers: { ...headers } };
  if (body !== undefined) {
    if (raw) init.body = body;
    else {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
  }
  const res = await fetch(`/api/panel${path}`, init);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/login') window.dispatchEvent(new CustomEvent('panel:unauthorized'));
  if (!res.ok) throw new ApiError(data.error || `Error ${res.status}`, res.status, data);
  return data;
}

export default api;
