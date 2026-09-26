# CLAUDE.md — Asistente de WhatsApp White-Label para clínicas dentales (Perú)

Hace el trabajo de una recepcionista 24/7: capta leads de Meta Ads, responde, envía fotos, agenda con
disponibilidad real, confirma, recuerda, reprograma, pasa a humano ante urgencias y reporta al dueño.
Prioridad del producto: **vender ya** — cada cambio deja el producto funcionando y demostrable.

## Stack real

- **Node.js 24, ESM** (`"type": "module"`): solo `import`/`export`. Nunca CommonJS.
- **Express 5** (`index.js`), sin frontend build: el panel es HTML/JS plano en `public/`.
- **Gemini** (`@google/generative-ai`) para la conversación: `services/geminiService.js`.
- **Supabase** (`@supabase/supabase-js`, service role) para persistencia.
- **WhatsApp Cloud API** (Meta) vía `fetch`: `services/whatsappService.js`.
- Tests: `node:test` + `assert`, sin dependencias extra. Deploy: Render (Dockerfile).

## Comandos

```bash
npm install
npm start                      # node index.js (puerto PORT, por defecto 3000)
npm run test:unit              # todos los services/*.test.js (multiplataforma)
node --check <archivo.js>      # verificación rápida de sintaxis
pwsh scripts/generate-demo-media.ps1   # regenera las imágenes de la clínica demo
```

## Mapa del código

| Área | Archivo |
|---|---|
| Clínica activa, validación, teléfonos (env), media, sinónimos | `config/clinic.config.js` |
| Datos de cada clínica (uno por cliente) | `config/clinics/<id>.js` (demo: `denvari.js`) |
| Plantillas de WhatsApp por nombre | `config/whatsappTemplates.js` + `docs/whatsapp-templates.md` |
| Webhook, debounce, flujo de mensajes | `controllers/webhookController.js` |
| Prompt de la asistente y Fase A/B de agendamiento | `services/geminiService.js` |
| Agenda con disponibilidad | `services/appointmentService.js` |
| Pase a humano / urgencias | `services/handoffService.js` |
| Recordatorios, resumen diario, seguimiento | `services/jobsService.js` + `routes/jobs.js` |
| Panel de recepción | `public/panel.html`, `public/panel.js`, `controllers/panelController.js`, `services/panelDataService.js` |
| Etiquetas de fotos `[ENVIAR_FOTO: x]` | `services/mediaTags.js` |
| Esquema de base de datos | `migrations/*.sql` (en orden de fecha) |

Flujo de un mensaje: webhook → debounce 2 s → ¿bot en pausa? → ¿urgencia / pide humano? → ¿cancelar, reprogramar
o responder un recordatorio? → ¿pide cita? (ofrece 3 horarios) → Gemini → Fase B guarda la cita y avisa a recepción
→ fotos en secuencia cada 300 ms.

## Reglas (no negociables)

1. **ESM** siempre (`import`/`export`).
2. **No tocar el debounce** `BUFFER_WAIT_MS = 2000` de `controllers/webhookController.js`.
3. **Cero datos fijos de una clínica** en controladores, servicios, prompts o `public/`: todo sale de
   `config/clinics/<id>.js`. Ningún teléfono en el código ni en `config/clinics/*.js`: se leen de
   `CLINIC_PHONE`, `RECEPTION_ALERT_PHONE` y `OWNER_ALERT_PHONE`. Sin números de respaldo inventados.
4. **Tests en verde** (`npm run test:unit`, 0 fallos). Toda funcionalidad nueva lleva tests con mocks
   (Supabase falso en `services/testing/fakeSupabase.js`; servicios con fábricas `create*({ getClient, whatsapp, now })`).
5. Trabajar en ramas con un commit por fase. **No hacer push ni merge a `main`** sin revisión del dueño.
6. **No tocar `.env`** ni mostrar claves. Cada variable nueva se documenta en `.env.example`.
7. **Reutilizar antes de crear**: `persistAgendaPayload`, `notificationService`, `whatsappService`,
   `leadService`, `toggleBot`/`handoffService`.
8. **Seguridad clínica**: el bot no diagnostica ni receta. Dolor fuerte, sangrado, hinchazón, fiebre o golpe →
   se deriva de inmediato a un humano (bot en pausa) y se avisa a recepción.
9. La respuesta de agendamiento dice **"solicitud de cita … Recepción te la confirmará"**: nunca prometer
   que el horario quedó bloqueado.
10. Fuera de la ventana de 24 h de WhatsApp solo se envían **plantillas aprobadas** (`sendWithWindow` lo decide).
11. Tareas periódicas solo por **`POST /jobs/*` con `CRON_SECRET`** (Render duerme el servicio: nada de `setInterval`).
12. Nada de fotos de pacientes reales en `media/`. La clínica demo usa ilustraciones propias.

## Nueva clínica en 3 pasos

1. **Copia la demo:** `config/clinics/denvari.js` → `config/clinics/<id>.js` (el `id` dentro del archivo debe
   ser igual al nombre del archivo, en minúsculas).
2. **Cambia datos e imágenes:** nombre, asistente, dirección, `mapsUrl`, horario por día, `slotMinutes`,
   campaña, tratamientos (precio, duración, sinónimos), FAQ y, opcional, `reviewUrl`. Pon las fotos en
   `media/<id>/` con los nombres de `media: {...}` (logo, fachada, ubicación y una por tratamiento).
   Al arrancar se valida todo: si falta un campo, el error dice cuál.
3. **Configura Render y la base de datos:**
   - Variables: `ACTIVE_CLINIC=<id>`, `CLINIC_PHONE`, `RECEPTION_ALERT_PHONE`, `OWNER_ALERT_PHONE`,
     `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`,
     `GEMINI_API_KEY`, `SUPABASE_URL` (sin `/rest/v1`), `SUPABASE_SERVICE_ROLE_KEY`, `PANEL_USER`,
     `PANEL_PASSWORD`, `CRON_SECRET` (lista completa en `.env.example`).
   - Ejecuta en el SQL Editor de Supabase, en orden, los archivos de `migrations/` que aún no estén aplicados
     (como mínimo `20260925_create_appointments.sql` y `20260926_create_follow_ups.sql`).
   - Crea los 3 cron jobs (`/jobs/reminders`, `/jobs/daily-summary`, `/jobs/follow-ups`) y envía las plantillas
     a aprobación: todo está en `docs/whatsapp-templates.md`.

## Verificación antes de entregar

```bash
node --check <cada archivo modificado>
npm run test:unit
grep -riE "<nombres de clientes anteriores>" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=archive .
```

Carpetas que no son parte del producto: `archive/` (paneles antiguos) y `node_modules/`, ambas en `.gitignore`.
