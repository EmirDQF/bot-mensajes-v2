# CLAUDE.md — Asistente de WhatsApp White-Label para clínicas dentales (Perú)

Hace el trabajo de una recepcionista 24/7: capta leads de Meta Ads, responde, envía fotos, registra solicitudes de
cita con disponibilidad real (recepción las confirma), recuerda, reprograma, pasa a humano ante urgencias y reporta
al dueño. El diferencial es la atención **fuera de horario** (modo nocturno).
Prioridad del producto: **vender ya** — cada cambio deja el producto funcionando y demostrable.

## Stack real

- **Node.js 24, ESM** (`"type": "module"`): solo `import`/`export`. Nunca CommonJS.
- **Express 5**: `app.js` arma la app (`createApp`, testeable) e `index.js` la levanta. Sin frontend build: el
  panel es HTML/JS plano en `public/`.
- **Gemini** (`@google/generative-ai`) para la conversación: `services/geminiService.js`.
- **Supabase** (`@supabase/supabase-js`, service role) para persistencia.
- **WhatsApp Cloud API** (Meta) vía `fetch`: `services/whatsappService.js`.
- Tests: `node:test` + `assert`, sin dependencias extra. Deploy: Render (`render.yaml`, guía en `docs/deploy.md`).

## Comandos

```bash
npm install
npm start                      # node index.js (puerto PORT, por defecto 3000)
npm run test:unit              # todos los services/*.test.js (multiplataforma)
npm run preflight              # revisa variables, tablas/columnas de Supabase, WhatsApp, Gemini y clínica (sin secretos)
npm run simulate               # conversaciones reales contra Gemini con WhatsApp/Supabase falsos → docs/qa-report.md
npm run new-clinic -- <id> "<Nombre>"  # genera config/clinics/<id>.js con TODO y media/<id>/
node --check <archivo.js>      # verificación rápida de sintaxis
pwsh scripts/generate-demo-media.ps1   # ilustraciones de la demo (o -ClinicId/-ClinicName para otra clínica)
```

## Mapa del código

| Área | Archivo |
|---|---|
| Clínica activa, validación, teléfonos (env), media, sinónimos | `config/clinic.config.js` |
| Datos de cada clínica (uno por cliente) | `config/clinics/<id>.js` (demo: `denvari.js`) |
| Plantillas de WhatsApp por nombre | `config/whatsappTemplates.js` + `docs/whatsapp-templates.md` |
| App Express (`/health` primero, `/health/deep`, panel, jobs, webhook) | `app.js` (`index.js` solo arranca) |
| Webhook, debounce, flujo de mensajes, modo nocturno, respaldo si Gemini falla | `controllers/webhookController.js` |
| Deduplicación del webhook por `message.id` | `services/messageDedup.js` (tabla `webhook_events`) |
| Prompt de la asistente y Fase A/B de agendamiento | `services/geminiService.js` |
| Agenda con disponibilidad, horario de atención (`isWithinWorkingHours`) | `services/appointmentService.js` |
| Primer contacto: tiempo de primera respuesta y `after_hours` | `services/conversationMetrics.js` |
| Reloj único (lo fija el simulador) | `services/clock.js` |
| Pase a humano / urgencias | `services/handoffService.js` |
| Recordatorios, resumen diario, seguimiento | `services/jobsService.js` + `routes/jobs.js` |
| Reporte semanal y línea de la garantía | `services/reportService.js` (`POST /jobs/weekly-report`, pestaña Reporte) |
| Panel de recepción | `public/panel.html`, `public/panel.js`, `controllers/panelController.js`, `services/panelDataService.js` |
| Etiquetas de fotos `[ENVIAR_FOTO: x]` | `services/mediaTags.js` |
| Esquema de base de datos | `migrations/*.sql` (en orden de fecha; todos idempotentes) |
| Scripts | `scripts/preflight.js`, `scripts/simulate-conversations.js`, `scripts/new-clinic.js` |
| Docs | `docs/deploy.md`, `docs/onboarding-cliente.md`, `docs/whatsapp-templates.md`, `docs/qa-report.md`, `docs/ventas/` |

Flujo de un mensaje: webhook (200 a Meta y dedup por `message.id`) → primer contacto: bienvenida + privacidad (+ aviso
nocturno) y, si trae una pregunta, se responde sin pedir que la repita → debounce 2 s → ¿bot en pausa? → ¿urgencia /
pide humano? → ¿cancelar, reprogramar o responder un recordatorio? → ¿pide cita, o de noche pregunta precio o
tratamiento? (3 horarios, desde el día que pida) → Gemini (si falla: horarios o aviso + alerta a recepción) → Fase B
guarda la solicitud (rechaza horarios fuera de atención) y avisa a recepción → fotos en secuencia cada 300 ms.

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
12. Nada de fotos de pacientes reales en `media/` sin consentimiento escrito. La clínica demo usa ilustraciones propias.
13. Nunca fingir ser una persona: la asistente es virtual y lo dice si se lo preguntan.
14. Textos de venta y reportes solo con datos medidos por el sistema o por la prueba nocturna: nada de estadísticas inventadas.

## Nueva clínica en 3 pasos (detalle comercial en `docs/onboarding-cliente.md`)

1. **Genera la clínica:** `npm run new-clinic -- <id> "<Nombre>"` crea `config/clinics/<id>.js` con `TODO` en cada
   dato a reemplazar y la carpeta `media/<id>/`.
2. **Completa datos e imágenes:** dirección, `mapsUrl`, horario por día, campaña, precios "desde", FAQ y, opcional,
   `reviewUrl`. Pon las fotos en `media/<id>/` con los nombres de `media: {...}` (o genera ilustraciones con
   `scripts/generate-demo-media.ps1 -ClinicId <id> ...`). Al arrancar se valida todo: si falta un campo o queda un
   `TODO`, el error dice cuál.
3. **Configura Render y la base de datos:**
   - Variables: `ACTIVE_CLINIC=<id>`, `CLINIC_PHONE`, `RECEPTION_ALERT_PHONE`, `OWNER_ALERT_PHONE`,
     `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`,
     `GEMINI_API_KEY`, `SUPABASE_URL` (sin `/rest/v1`), `SUPABASE_SERVICE_ROLE_KEY`, `PANEL_USER`,
     `PANEL_PASSWORD`, `CRON_SECRET` (lista completa en `.env.example`).
   - Ejecuta en el SQL Editor de Supabase, en orden, los archivos de `migrations/` que aún no estén aplicados.
   - Crea las 6 tareas de cron-job.org y envía las plantillas a aprobación: `docs/deploy.md` y
     `docs/whatsapp-templates.md`. Termina con `npm run preflight` en ✅.

## Verificación antes de entregar

```bash
node --check <cada archivo modificado>
npm run test:unit
npm run preflight
grep -riE "<nombres de clientes anteriores>" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=archive .
```

Carpetas que no son parte del producto: `archive/` (paneles antiguos) y `node_modules/`, ambas en `.gitignore`.
