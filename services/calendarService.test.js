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

describe('calendarService', () => {
  it('checkAvailability returns true when no conflicting events', async () => {
    const mockCal = makeMockCalendar({ existingEvents: [] });
    // Monkeypatch getCalendarClient for test
    cs.__setTestCalendarClient({ events: mockCal.events });
    try {
      const ok = await cs.checkAvailability('2026-08-20T10:00:00Z');
      assert.equal(ok, true);
    } finally {
      cs.__setTestCalendarClient(null);
    }
  });

  it('checkAvailability returns false when conflicting events exist', async () => {
    const mockCal = makeMockCalendar({ existingEvents: [{ id: 'e1' }] });
    cs.__setTestCalendarClient({ events: mockCal.events });
    try {
      const ok = await cs.checkAvailability('2026-08-20T10:00:00Z');
      assert.equal(ok, false);
    } finally {
      cs.__setTestCalendarClient(null);
    }
  });

  it('createCalendarEvent returns event data on success', async () => {
    const mockCal = makeMockCalendar({ existingEvents: [], insertSucceeds: true });
    cs.__setTestCalendarClient({ events: mockCal.events });
    try {
      const res = await cs.createCalendarEvent({ name: 'Test Paciente', phone: '51987654321', service: 'Limpieza', datetime: '2026-08-20T10:00:00Z' });
      assert.equal(res && res.id, 'mock-event-id');
    } finally {
      cs.__setTestCalendarClient(null);
    }
  });

  it('createCalendarEvent propagates insert exceptions', async () => {
    const mockCal = makeMockCalendar({ existingEvents: [], insertThrows: true });
    cs.__setTestCalendarClient({ events: mockCal.events });
    try {
      try {
        await cs.createCalendarEvent({ name: 'Test Paciente', phone: '51987654321', service: 'Limpieza', datetime: '2026-08-20T10:00:00Z' });
        assert.fail('Expected to throw');
      } catch (e) {
        assert.ok(e && e.message && e.message.includes('Google API failure'));
      }
    } finally {
      cs.__setTestCalendarClient(null);
    }
  });
});
