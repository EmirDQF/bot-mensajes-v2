import assert from 'assert';
import { describe, it, before } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.ADMIN_WHATSAPP_NUMBER = '51987654321';

let notificationService;

before(async () => {
  notificationService = (await import('./notificationService.js')).default;
});

describe('notificationService', () => {
  it('sends an admin alert and marks the lead as notified for new ready leads', async () => {
    let sentTo = null;
    let sentText = null;
    let notifiedId = null;

    const mockWhatsapp = {
      async sendWhatsAppMessage(toPhone, text) {
        sentTo = toPhone;
        sentText = text;
        return { success: true };
      },
    };

    const mockLeadService = {
      async markAsNotified(id) {
        notifiedId = id;
        return { id, notified_at: new Date().toISOString() };
      },
    };

    const lead = {
      id: 'lead-123',
      ready_to_notify: true,
      notified_at: null,
      nombre: 'Tom Holland',
      telefono: '987654321',
      distrito: 'Miraflores',
      fecha_hora_texto: 'jueves 6 de agosto, 3:00 PM',
    };

    const result = await notificationService.notifyAdminNewLead(lead, {
      whatsappService: mockWhatsapp,
      leadService: mockLeadService,
    });

    assert.equal(result, true);
    assert.equal(sentTo, '51987654321');
    assert.ok(sentText.includes('🚨 ¡NUEVO PACIENTE AGENDADO!'));
    assert.ok(sentText.includes('Tom Holland'));
    assert.ok(sentText.includes('https://wa.me/51987654321'));
    assert.ok(sentText.includes('jueves 6 de agosto, 3:00 PM'));
    assert.equal(notifiedId, 'lead-123');
  });

  it('does not send admin alert if lead is already notified', async () => {
    let sent = false;
    const result = await notificationService.notifyAdminNewLead({
      id: 'lead-456',
      ready_to_notify: true,
      notified_at: '2026-01-01T00:00:00+00:00',
      nombre: 'Test',
      telefono: '987654321',
      distrito: 'Lima',
      fecha_hora_texto: 'lunes 10am',
    }, {
      whatsappService: { async sendWhatsAppMessage() { sent = true; } },
      leadService: { async markAsNotified() { sent = true; } },
    });

    assert.equal(result, false);
    assert.equal(sent, false);
  });
});
