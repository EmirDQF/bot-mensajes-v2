import { describe, it } from 'node:test';
import assert from 'assert';
import * as cs from './calendarService.js';

// Mock calendar client shape used by calendarService
function makeMockCalendar({ existingEvents = [], insertSucceeds = true, insertThrows = false } = {}) {
  return {
    events: {
      list: async (opts) => {
        return { data: { items: existingEvents } };
      },
      insert: async (opts) => {
        if (insertThrows) throw new Error('Google API failure');
        if (insertSucceeds) return { data: { id: 'mock-event-id' }, status: 200 };
        return { status: 500 };
      }
    }
  };
}

describe('calendarService.createCalendarEvent', () => {
  it('creates event when no overlap', async () => {
    const mockCal = makeMockCalendar({ existingEvents: [], insertSucceeds: true });
    const res = await cs.createCalendarEvent({
      patientName: 'Test Paciente',
      phone: '51987654321',
      service: 'Limpieza',
      startDateTime: '2026-08-20T10:00:00Z',
      endDateTime: '2026-08-20T10:30:00Z'
    }, { calendarClient: mockCal, calendarId: 'quispefernandezdiego79@gmail.com' });

    assert.equal(res, true);
  });

  it('returns false when overlapping events exist', async () => {
    const mockCal = makeMockCalendar({ existingEvents: [{ id: 'e1' }] });
    const res = await cs.createCalendarEvent({
      patientName: 'Test Paciente',
      phone: '51987654321',
      service: 'Limpieza',
      startDateTime: '2026-08-20T10:00:00Z',
      endDateTime: '2026-08-20T10:30:00Z'
    }, { calendarClient: mockCal, calendarId: 'quispefernandezdiego79@gmail.com' });

    assert.equal(res, false);
  });

  it('throws or returns false when API insert fails', async () => {
    const mockCal = makeMockCalendar({ existingEvents: [], insertSucceeds: false });
    const res = await cs.createCalendarEvent({
      patientName: 'Test Paciente',
      phone: '51987654321',
      service: 'Limpieza',
      startDateTime: '2026-08-20T10:00:00Z',
      endDateTime: '2026-08-20T10:30:00Z'
    }, { calendarClient: mockCal, calendarId: 'quispefernandezdiego79@gmail.com' });

    assert.equal(res, false);
  });

  it('propagates exceptions from API', async () => {
    const mockCal = makeMockCalendar({ existingEvents: [], insertThrows: true });
    try {
      await cs.createCalendarEvent({
        patientName: 'Test Paciente',
        phone: '51987654321',
        service: 'Limpieza',
        startDateTime: '2026-08-20T10:00:00Z',
        endDateTime: '2026-08-20T10:30:00Z'
      }, { calendarClient: mockCal, calendarId: 'quispefernandezdiego79@gmail.com' });
      assert.fail('Expected to throw');
    } catch (e) {
      assert.ok(e && e.message && e.message.includes('Google API failure'));
    }
  });
});
