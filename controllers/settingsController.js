import defaultSettings from '../services/clinicSettings.js';

// Pestaña ⚙️ Configuración (solo el dueño). Todas las escrituras quedan en clinic_settings_audit.

function fail(res, error, fallback) {
  const status = Number(error?.status) || 500;
  if (status >= 500 && status !== 503) console.error(`[Config] ${fallback}:`, error?.message || error);
  return res.status(status).json({ error: status === 500 ? fallback : error.message, errors: error?.errors || undefined });
}

export function createSettingsController({ settings = defaultSettings } = {}) {
  const by = (req) => req.panelSession?.user || 'dueño';

  return {
    async get(req, res) {
      try {
        await settings.ensureFresh();
        return res.json(settings.snapshot());
      } catch (error) {
        return fail(res, error, 'No se pudo leer la configuración');
      }
    },
    async save(req, res) {
      try {
        return res.json(await settings.save(req.body?.changes || {}, by(req)));
      } catch (error) {
        return fail(res, error, 'No se pudo guardar la configuración');
      }
    },
    async reset(req, res) {
      const fields = req.body?.fields === 'all' ? 'all' : Array.isArray(req.body?.fields) ? req.body.fields : [];
      try {
        return res.json(await settings.reset(fields, by(req)));
      } catch (error) {
        return fail(res, error, 'No se pudieron restaurar los valores base');
      }
    },
    async audit(req, res) {
      try {
        return res.json(await settings.auditLog(Math.min(200, Number(req.query.limit) || 50)));
      } catch (error) {
        return fail(res, error, 'No se pudo leer el historial');
      }
    },
    async photo(req, res) {
      try {
        return res.json(await settings.uploadPhoto({ buffer: req.body, contentType: req.get('content-type') }));
      } catch (error) {
        return fail(res, error, 'No se pudo subir la foto');
      }
    },
  };
}

export default createSettingsController();
