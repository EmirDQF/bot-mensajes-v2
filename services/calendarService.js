import { google } from 'googleapis';
import fs from 'fs/promises';

function loadServiceAccountCredentials() {
  const calendarId = process.env.GOOGLE_CALENDAR_ID || null;
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL || null;
  const privateKeyEnv = process.env.GOOGLE_PRIVATE_KEY || null;
  const privateKeyPath = process.env.GOOGLE_PRIVATE_KEY_PATH || null;

  let privateKey = null;
  if (privateKeyEnv) {
    // Support escaped newlines and remove surrounding quotes if the value was stringified
    const rawKey = privateKeyEnv;
    privateKey = rawKey.replace(/\\n/g, '\n').replace(/^['"]|['"]$/g, '');
  }

  return { calendarId, clientEmail, privateKey, privateKeyPath };
}

async function getJwtClient() {
  const creds = loadServiceAccountCredentials();
  if (!creds.clientEmail && !creds.privateKey && !creds.privateKeyPath) {
    throw new Error('Google service account credentials not configured (GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY)');
  }

  let key = creds.privateKey;
  if (!key && creds.privateKeyPath) {
    // read file if path provided
    try {
      key = await fs.readFile(creds.privateKeyPath, 'utf8');
    } catch (e) {
      throw new Error('Failed to read GOOGLE_PRIVATE_KEY_PATH: ' + e.message);
    }
  }

  const jwt = new google.auth.JWT(
    creds.clientEmail,
    null,
    key,
    ['https://www.googleapis.com/auth/calendar']
  );
  await jwt.authorize();
  return jwt;
}

export async function createCalendarEvent({ patientName, phone, service, startDateTime, endDateTime, notes = '' }, options = {}) {
  if (!patientName || !startDateTime || !endDateTime) {
    throw new Error('Missing required fields for createCalendarEvent');
  }

  // Allow dependency injection for tests: options.calendarClient (mock) and options.calendarId
  const creds = loadServiceAccountCredentials();
  const calendarId = options.calendarId || creds.calendarId;
  if (!calendarId) throw new Error('GOOGLE_CALENDAR_ID not set in environment');

  // In deployment we expect the clinic calendar to be the configured one
  if (process.env.GOOGLE_CALENDAR_ID && process.env.GOOGLE_CALENDAR_ID !== calendarId) {
    console.log('[calendarService] using overridden calendarId:', calendarId);
  }

  const calendarClient = options.calendarClient;
  let calendar;
  if (calendarClient) {
    calendar = calendarClient;
  } else {
    const auth = await getJwtClient();
    calendar = google.calendar({ version: 'v3', auth });
  }

  // Validate availability: list events overlapping the proposed window
  const timeMin = new Date(startDateTime).toISOString();
  const timeMax = new Date(endDateTime).toISOString();

  const existing = await calendar.events.list({
    calendarId,
    timeMin,
    timeMax,
    singleEvents: true,
    maxResults: 10,
    orderBy: 'startTime',
  });

  if (existing && existing.data && Array.isArray(existing.data.items) && existing.data.items.length > 0) {
    // There is at least one event in the requested range -> conflict
    return false;
  }

  // Build event
  const summary = `Cita Dental: ${patientName} - ${service || 'Evaluación'}`;
  const descriptionParts = [];
  if (phone) descriptionParts.push(`Teléfono paciente: ${phone}`);
  if (notes) descriptionParts.push(`Notas: ${notes}`);
  const description = descriptionParts.join('\n');

  const event = {
    summary,
    description,
    start: { dateTime: new Date(startDateTime).toISOString() },
    end: { dateTime: new Date(endDateTime).toISOString() },
  };

  const created = await calendar.events.insert({
    calendarId,
    resource: event,
  });

  if (created && created.status === 200) return true;
  // Some clients return data object; treat presence as success
  if (created && created.data && created.data.id) return true;

  return false;
}
