import { google } from 'googleapis';

/**
 * Obtiene el cliente autenticado de Google Calendar
 */
let _testCalendarClient = null;
export function __setTestCalendarClient(client) { _testCalendarClient = client; }

export function getCalendarClient() {
  if (_testCalendarClient) return _testCalendarClient;

  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let privateKey = process.env.GOOGLE_PRIVATE_KEY || process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || process.env.GOOGLE_KEY;

  if (!clientEmail || !privateKey) {
    console.error('❌ [Calendar Auth] Faltan credenciales:', {
      hasEmail: Boolean(clientEmail),
      hasKey: Boolean(privateKey),
      emailValue: clientEmail
    });
    throw new Error(`Credenciales incompletas: clientEmail=${Boolean(clientEmail)}, privateKey=${Boolean(privateKey)}`);
  }

  // Normalizar saltos de línea literales \n y comillas envolventes
  privateKey = privateKey.replace(/\\n/g, '\n').replace(/^['"]|['"]$/g, '');

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: clientEmail,
      private_key: privateKey,
    },
    scopes: [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/calendar.readonly'
    ]
  });

  return google.calendar({ version: 'v3', auth });
}

function isGoogleAccountCredentialFailure(error) {
  const message = String(error && (error.message || error.code || error.status || ''));
  const details = String(error && error.errors ? JSON.stringify(error.errors) : '');
  return /invalid_grant|account not found|not found.*account|refresh token.*revoked|token has been revoked|unauthorized_client/i.test(`${message} ${details}`);
}

/**
 * Verifica si hay conflicto de horario en el calendario
 */
export async function checkAvailability(datetime) {
  try {
    const calendar = getCalendarClient();
    const calendarId = process.env.GOOGLE_CALENDAR_ID || 'quispefernandezdiego79@gmail.com';

    const target = new Date(datetime);
    if (isNaN(target.getTime())) return true;

    // Rango de búsqueda: 30 minutos antes y después
    const timeMin = new Date(target.getTime() - 30 * 60 * 1000).toISOString();
    const timeMax = new Date(target.getTime() + 30 * 60 * 1000).toISOString();

    const response = await calendar.events.list({
      calendarId,
      timeMin,
      timeMax,
      singleEvents: true,
    });

    const hasConflict = response.data.items && response.data.items.length > 0;
    console.log(`📅 [Calendar Check]: Disponibilidad para ${datetime} -> ${!hasConflict ? 'LIBRE' : 'OCUPADO'}`);
    return !hasConflict;
  } catch (e) {
    if (isGoogleAccountCredentialFailure(e)) {
      console.error('[Calendar Check Warning] Google Calendar credentials invalid or revoked. This blocks booking until Render env is fixed.');
      console.error('[Calendar Check Warning] Details:', e && e.message ? e.message : e);
      return false;
    }
    console.warn('⚠️ [Calendar Check Warning]: No se pudo verificar disponibilidad, continuando:', e.message);
    return true;
  }
}

/**
 * Inserta la cita confirmada en Google Calendar
 */
export async function createCalendarEvent({ name, phone, service, datetime, summary }) {
  try {
    const calendar = getCalendarClient();
    const calendarId = process.env.GOOGLE_CALENDAR_ID || 'quispefernandezdiego79@gmail.com';

    const startDateTime = new Date(datetime);
    if (isNaN(startDateTime.getTime())) {
      throw new Error(`Fecha/hora inválida provista para la cita: ${datetime}`);
    }

    // Duración estimada: 45 minutos
    const endDateTime = new Date(startDateTime.getTime() + 45 * 60 * 1000);

    const event = {
      summary: summary || `🦷 Cita: ${name} - ${service || 'Evaluación'}`,
      description: `👤 Paciente: ${name}\n📱 Teléfono: ${phone}\n🦷 Tratamiento: ${service || 'Evaluación General'}\n📍 Sede: Av. Alameda de la República 286 - Huánuco`,
      start: { dateTime: startDateTime.toISOString(), timeZone: 'America/Lima' },
      end: { dateTime: endDateTime.toISOString(), timeZone: 'America/Lima' },
    };

    const res = await calendar.events.insert({
      calendarId: calendarId,
      requestBody: event,
    });

    console.log('✅ [Google Calendar] Evento creado con éxito. ID:', res.data.id);
    return res.data;
  } catch (error) {
    const details = error && error.response && error.response.data ? error.response.data : (error && error.message ? error.message : error);
    if (isGoogleAccountCredentialFailure(error)) {
      console.error('[Google Calendar] invalid_grant/account not found detected. The stored Google OAuth/service-account credentials are invalid or revoked. Check Render env vars: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN or the Google service account and regenerate the token if needed.');
      console.error('[Google Calendar] Details:', details);
    } else {
      console.error('❌ [Calendar Insert Error]', details);
    }
    throw error;
  }
}

// Wrapper: obtener slots reservados en una fecha (ISO yyyy-mm-dd)
export async function getBookedSlots(dateStr) {
  try {
    const calendar = getCalendarClient();
    const calendarId = process.env.GOOGLE_CALENDAR_ID || 'quispefernandezdiego79@gmail.com';

    const timeMin = new Date(`${dateStr}T00:00:00-05:00`).toISOString();
    const timeMax = new Date(`${dateStr}T23:59:59-05:00`).toISOString();

    const response = await calendar.events.list({
      calendarId,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime',
    });

    return (response.data.items || []).map(event => {
      const start = new Date(event.start.dateTime || event.start.date);
      const end = new Date(event.end.dateTime || event.end.date);
      return {
        summary: event.summary,
        startStr: start.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/Lima' }),
        endStr: end.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/Lima' }),
        start,
        end,
      };
    });
  } catch (error) {
    console.error('Error al consultar Google Calendar:', error && error.message ? error.message : error);
    return [];
  }
}

// Wrapper: comprobar disponibilidad para un slot concreto
export async function checkSlotAvailable(startDateTime, durationMinutes = 30) {
  try {
    const calendar = getCalendarClient();
    const calendarId = process.env.GOOGLE_CALENDAR_ID || 'quispefernandezdiego79@gmail.com';
    const start = new Date(startDateTime);
    if (isNaN(start.getTime())) return false;
    const end = new Date(start.getTime() + durationMinutes * 60000);

    const response = await calendar.events.list({
      calendarId,
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: true,
    });

    return (response.data.items || []).length === 0;
  } catch (error) {
    if (isGoogleAccountCredentialFailure(error)) {
      console.error('[Calendar Slot Check] Google Calendar credentials invalid or revoked. Booking is blocked until credentials are fixed.');
      console.error('[Calendar Slot Check] Details:', error && error.message ? error.message : error);
    } else {
      console.error('Error validando disponibilidad de slot:', error && error.message ? error.message : error);
    }
    return false;
  }
}
