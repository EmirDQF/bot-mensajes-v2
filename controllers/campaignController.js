import defaultCampaigns, { CONFIRM_WORD, SEGMENT_TYPES } from '../services/campaignService.js';
import activeClinic, { activePromotions } from '../config/clinic.config.js';
import { localParts } from '../services/appointmentService.js';
import { now as clockNow } from '../services/clock.js';

// Pestaña 📣 Campañas (solo el dueño): promociones a pacientes anteriores con permiso de promociones.

function fail(res, error, fallback) {
  const status = Number(error?.status) || 500;
  if (status >= 500 && status !== 503) console.error(`[Campañas] ${fallback}:`, error?.message || error);
  return res.status(status).json({ error: status === 500 ? fallback : error.message, errors: error?.errors || undefined });
}

export function createCampaignController({ campaigns = defaultCampaigns, clinic = activeClinic, now = clockNow } = {}) {
  const by = (req) => req.panelSession?.user || 'dueño';
  return {
    async list(req, res) {
      try {
        const today = localParts(clinic.timezone, now()).date;
        const active = activePromotions(today, clinic);
        return res.json({
          campaigns: await campaigns.list(),
          segmentTypes: SEGMENT_TYPES,
          promotions: (clinic.promotions || []).map((p, index) => ({ index, title: p.title, validFrom: p.validFrom || null, validUntil: p.validUntil || null, active: active.includes(p) })),
          treatments: clinic.treatments.map(({ key, name }) => ({ key, name })),
          marketingPrice: clinic.marketingPrice || null,
          confirmWord: CONFIRM_WORD,
        });
      } catch (error) {
        return fail(res, error, 'No se pudieron leer las campañas');
      }
    },
    async preview(req, res) {
      try {
        return res.json(await campaigns.preview(req.body || {}));
      } catch (error) {
        return fail(res, error, 'No se pudo calcular la campaña');
      }
    },
    async create(req, res) {
      try {
        return res.status(201).json(await campaigns.create({ ...(req.body || {}), by: by(req) }));
      } catch (error) {
        return fail(res, error, 'No se pudo programar la campaña');
      }
    },
    async cancel(req, res) {
      try {
        return res.json(await campaigns.cancel(req.params.id));
      } catch (error) {
        return fail(res, error, 'No se pudo cancelar la campaña');
      }
    },
    async report(req, res) {
      try {
        return res.json(await campaigns.report(req.params.id));
      } catch (error) {
        return fail(res, error, 'No se pudo leer el reporte');
      }
    },
  };
}

export default createCampaignController();
