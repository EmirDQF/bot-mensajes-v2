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
    console.warn('⚠️ [Calendar Check Warning]: No se pudo verificar disponibilidad, continuando:', e.message);
    return true;
  }
}

/**
 * Inserta la cita confirmada en Google Calendar
 */
export async function createCalendarEvent({ name, phone, service, datetime }) {
  const calendar = getCalendarClient();
  const calendarId = process.env.GOOGLE_CALENDAR_ID || 'quispefernandezdiego79@gmail.com';

  const startDateTime = new Date(datetime);
  if (isNaN(startDateTime.getTime())) {
    throw new Error(`Fecha/hora inválida provista para la cita: ${datetime}`);
  }

  // Duración estimada: 45 minutos
  const endDateTime = new Date(startDateTime.getTime() + 45 * 60 * 1000);

  const event = {
    summary: `🦷 Cita: ${name} - ${service || 'Evaluación'}`,
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
}
