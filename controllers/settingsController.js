import defaultSettings from '../services/clinicSettings.js';
import activeClinic, { mergeClinic, pickEditable } from '../config/clinic.config.js';
import { packCardPng } from '../services/cards/packCard.js';
import { appointmentPassPng } from '../services/cards/appointmentPass.js';
import { localParts } from '../services/appointmentService.js';
import { now as clockNow } from '../services/clock.js';

// Pase de ejemplo para la vista previa (datos inventados, nunca de un paciente).
const SAMPLE_PASS = {
  id: 'ejemplo', code: 'EJ-0000', status: 'confirmada', patient_name: 'Paciente de ejemplo', treatment: 'Evaluación',
  appointment_date: '2026-12-01', appointment_time: '16:30',
};

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
    // Vista previa en vivo (sin guardar): tarjeta del pack o pase de ejemplo con los datos del formulario.
    async preview(req, res) {
      try {
        const draft = mergeClinic(activeClinic, pickEditable(req.body?.draft || {}));
        const today = localParts(draft.timezone, clockNow()).date;
        const kind = req.body?.kind === 'pass' ? 'pass' : 'pack';
        const specialist = draft.specialists?.[0]?.name || null;
        const png = kind === 'pass' ? appointmentPassPng({ ...SAMPLE_PASS, specialist }, draft) : packCardPng(draft, today);
        if (!png) return res.status(404).json({ error: 'Completa el título y qué incluye el pack para ver la vista previa.' });
        res.setHeader('Cache-Control', 'no-store');
        return res.type('image/png').send(png);
      } catch (error) {
        return fail(res, error, 'No se pudo generar la vista previa');
      }
    },
    async undo(req, res) {
      try {
        return res.json(await settings.undoLast(by(req)));
      } catch (error) {
        return fail(res, error, 'No se pudo deshacer el último cambio');
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
