import activeClinic from '../config/clinic.config.js';
import whatsappService from './whatsappService.js';
import { describeError } from './safeLog.js';

// Ubicación de la clínica: dirección + referencia + mapa y, si la clínica tiene latitude/longitude en su
// config, un mensaje de WhatsApp tipo "location" (el paciente lo abre directo en su app de mapas).

const LOCATION_INTENT = /\b(?:d[oó]nde\s+(?:quedan?|est[aá]n?|es|se\s+ubican?|atienden)|direcci[oó]n|ubicaci[oó]n|ubicad[oa]s?|c[oó]mo\s+llego|como\s+llegar|mapa|local\s+queda)\b/i;

export const wantsLocation = (text) => LOCATION_INTENT.test(String(text || ''));

export const hasCoordinates = (clinic = activeClinic) => Number.isFinite(clinic?.latitude) && Number.isFinite(clinic?.longitude);

export function locationText(clinic = activeClinic) {
  return [
    `📍 ${clinic.address}`,
    clinic.addressReference ? `Referencia: ${clinic.addressReference}` : null,
    `Cómo llegar: ${clinic.mapsUrl}`,
  ].filter(Boolean).join('\n');
}

// Envía el mensaje "location". Nunca lanza: devuelve true si se envió.
export async function sendClinicLocation(to, { whatsapp = whatsappService, clinic = activeClinic } = {}) {
  if (!hasCoordinates(clinic)) return false;
  try {
    await whatsapp.sendLocationMessage(to, {
      latitude: clinic.latitude, longitude: clinic.longitude, name: clinic.name, address: clinic.address,
    });
    return true;
  } catch (error) {
    console.error('[WhatsApp] No se pudo enviar la ubicación:', describeError(error));
    return false;
  }
}

export default { wantsLocation, hasCoordinates, locationText, sendClinicLocation };
