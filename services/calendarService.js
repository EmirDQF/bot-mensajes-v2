import { google } from 'googleapis';

let _testCalendarClient = null;

export function __setTestCalendarClient(client) {
  _testCalendarClient = client;
}

function getCalendarClient() {
  if (_testCalendarClient) return _testCalendarClient;

  const email = (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || process.env.GOOGLE_CLIENT_EMAIL || '').trim();
  let key = process.env.GOOGLE_PRIVATE_KEY || '';

  if (!email || !key) {
    throw new Error('Google Service Account credentials missing: GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY are required.');
  }

  key = key.replace(/^['"]|['"]$/g, '').replace(/\\n/g, '\n');

  const auth = new google.auth.JWT({
    email,
    key,
    scopes: [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.events'
    ]
  });

  return google.calendar({ version: 'v3', auth });
}

export async function checkSlotAvailable(startDateTime, durationMinutes = 30) {
  try {
    const calendar = getCalendarClient();
    const calendarId = process.env.GOOGLE_CALENDAR_ID;
    const start = new Date(startDateTime);
    const end = new Date(start.getTime() + durationMinutes * 60000);

    const response = await calendar.events.list({
      calendarId,
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: true
    });

    return (response.data.items || []).length === 0;
  } catch (error) {
    console.error('❌ Error comprobando disponibilidad:', error?.response?.data || error?.message || error);
    return false;
  }
}

export async function createCalendarEvent({
  patientName,
  phone,
  service = 'Ortodoncia',
  date,
  time,
  durationMinutes = 45,
  notes = '',
  startDateTime,
  name,
  datetime,
  summary,
  ...legacyProps
} = {}) {
  try {
    const calendar = getCalendarClient();
    const calendarId = (process.env.GOOGLE_CALENDAR_ID || '').trim();

    const legacyName = name || patientName || 'Paciente';
    const normalizedPhone = phone || legacyProps.phone || '';
    const normalizedService = service || legacyProps.service || 'Ortodoncia';
    const legacyDuration = Number.isFinite(Number(legacyProps.durationMinutes)) ? Number(legacyProps.durationMinutes) : durationMinutes;
    const finalDurationMinutes = Number.isFinite(Number(durationMinutes)) ? Number(durationMinutes) : legacyDuration;

    let start;
    let end;
    if (startDateTime) {
      start = new Date(startDateTime);
    } else if (datetime) {
      start = new Date(datetime);
    } else if (date && time) {
      start = new Date(`${date}T${time}:00-05:00`);
    } else {
      throw new Error('Falta especificar fecha y hora para el evento');
    }

    end = new Date(start.getTime() + finalDurationMinutes * 60000);

    const event = {
      summary: summary || `[PRESENCIAL] ${normalizedService} - ${legacyName}`,
      description: `Paciente: ${legacyName}\nTeléfono: +${normalizedPhone}\nServicio: ${normalizedService}\nNota: ${notes || 'Agendado automáticamente por BotDental'}\nConsulta: S/ 40`,
      start: { dateTime: start.toISOString(), timeZone: 'America/Lima' },
      end: { dateTime: end.toISOString(), timeZone: 'America/Lima' }
    };

    const response = await calendar.events.insert({
      calendarId,
      requestBody: event
    });

    console.log('✅ CITA INSERTADA CON ÉXITO EN CALENDAR! ID:', response.data.id);
    return response.data;
  } catch (error) {
    console.error('❌ ERROR FATAL AL INSERTAR EN GOOGLE CALENDAR:', error?.response?.data || error?.message || error);
    throw error;
  }
}

export async function getBookedSlots(dateStr) {
  try {
    const calendar = getCalendarClient();
    const calendarId = (process.env.GOOGLE_CALENDAR_ID || '').trim();
    const timeMin = new Date(`${dateStr}T00:00:00-05:00`).toISOString();
    const timeMax = new Date(`${dateStr}T23:59:59-05:00`).toISOString();

    const response = await calendar.events.list({
      calendarId,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime'
    });

    return (response.data.items || []).map(event => ({
      summary: event.summary,
      start: event.start.dateTime || event.start.date,
      end: event.end.dateTime || event.end.date
    }));
  } catch (error) {
    console.error('❌ Error obteniendo slots ocupados:', error?.response?.data || error?.message || error);
    return [];
  }
}

export async function checkAvailability(datetime, durationMinutes = 30) {
  return checkSlotAvailable(datetime, durationMinutes);
}

