# Puesta en producción (24/7, costo 0 para el primer cliente)

Guía paso a paso para dejar el asistente atendiendo WhatsApp las 24 horas. No hace falta programar:
solo copiar y pegar valores. Tiempo total: 60–90 minutos la primera vez.

**Qué vas a usar (todo con plan gratuito):**

| Servicio | Para qué | Costo |
|---|---|---|
| **Render** | Tiene el bot encendido y le da una dirección web | Gratis: 750 horas al mes, alcanzan para **UN** servicio 24/7 (24 h × 31 días = 744 h). Desde el **segundo cliente** conviene el plan **Starter** (de pago; revisa el precio vigente en render.com/pricing), porque dos servicios gratis no entran en las 750 h. |
| **Supabase** | Base de datos (citas, conversaciones, métricas) | Gratis. El proyecto gratuito se pausa si pasa 7 días sin uso: el paso 4 lo evita. |
| **Meta (WhatsApp Cloud API)** | El número de WhatsApp de la clínica | Responder dentro de las 24 h es gratis; las plantillas (recordatorios fuera de esa ventana) las cobra Meta a la tarjeta de la clínica. |
| **cron-job.org** | Despierta al bot y dispara recordatorios y reportes | Gratis. |

> Antes de empezar, ten a mano tu archivo `.env` local (o los valores de cada variable). **Nunca** lo subas a GitHub.

---

## 1. Render (el servidor)

1. Entra a <https://dashboard.render.com> e inicia sesión con tu cuenta de GitHub.
2. **New → Blueprint** → elige el repositorio del bot → **Connect**. Render lee el archivo `render.yaml`.
3. Render te pide el valor de cada variable. Cópialos de tu `.env`:

   | Variable | Qué poner |
   |---|---|
   | `ACTIVE_CLINIC` | El id de la clínica (ej. `denvari`, o el que creaste con `node scripts/new-clinic.js`) |
   | `CLINIC_PHONE`, `RECEPTION_ALERT_PHONE`, `OWNER_ALERT_PHONE` | Celulares en formato `519XXXXXXXX` (clínica, recepción y dueño) |
   | `GEMINI_API_KEY` | Clave de <https://aistudio.google.com/apikey> (empieza con `AIza`) |
   | `GEMINI_MODEL` | `gemini-3.5-flash-lite` |
   | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Del paso 3 (Meta) |
   | `ENFORCE_WHATSAPP_SIGNATURE` | `true` |
   | `WHATSAPP_API_VERSION` | `v21.0` |
   | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Del paso 2 (Supabase) |
   | `PANEL_USER`, `PANEL_PASSWORD` | Usuario y contraseña (12+ caracteres) del panel de recepción |
   | `CRON_SECRET` | Una clave larga al azar. Genérala con: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
   | `PUBLIC_BASE_URL` | Déjala vacía: Render usa su propia dirección (`RENDER_EXTERNAL_URL`) |
   | `PANEL_BACKEND_URL` | **Vacía** (así ningún mensaje sale a un sistema externo) |
   | El resto (`APPOINTMENT_MIN_LEAD_MINUTES`, `FOLLOW_UP_AFTER_HOURS`, `WA_TEMPLATE_*`) | Los valores de `.env.example` |

4. **Apply**. Cuando termine, copia la dirección del servicio (ej. `https://asistente-dental.onrender.com`).
   En esta guía la llamamos **TU-URL**.
5. Prueba: abre `TU-URL/health` en el navegador. Debe decir `{"status":"ok",...}`.

> Si luego cambias una variable: Render → tu servicio → **Environment** → editar → **Save changes** (se reinicia solo).

## 2. Supabase (la base de datos)

1. Entra a <https://supabase.com/dashboard> → **New project**. Región: **South America (São Paulo)** (la más cercana a Lima).
   Guarda la contraseña de la base de datos en un lugar seguro.
2. Menú izquierdo → **SQL Editor** → **New query**. Abre cada archivo de la carpeta `migrations/` **en este orden**,
   copia todo su contenido, pégalo y presiona **Run** (debe decir "Success"):
   1. `20260801_base_leads_messages.sql`
   2. `20260803_add_chatwoot_fields_to_clinics.sql`
   3. `20260806_add_lead_snapshot.sql`
   4. `20260823_create_chat_sessions.sql`
   5. `20260904_add_whatsapp_media_tracking.sql`
   6. `20260908_create_conversations.sql`
   7. `20260925_create_appointments.sql`
   8. `20260926_create_follow_ups.sql`
   9. `20260927_after_hours_metrics.sql`
   10. `20260928_create_webhook_events.sql`

   Todos se pueden ejecutar más de una vez sin romper nada.
3. **Project Settings → API**:
   - **Project URL** → es `SUPABASE_URL`. Debe verse así: `https://xxxx.supabase.co` (**sin** `/rest/v1` al final).
   - **service_role** (en "Project API keys", botón *Reveal*) → es `SUPABASE_SERVICE_ROLE_KEY`. Es secreta: solo va en Render.
4. Pon ambos valores en Render (paso 1) y en tu `.env` local.

## 3. Meta (WhatsApp de la clínica)

1. **Meta Business**: la clínica necesita una cuenta en <https://business.facebook.com> **verificada** (RUC y documentos).
   Sin verificación, Meta limita cuántas personas nuevas puede contactar la clínica por día.
2. **App**: <https://developers.facebook.com> → **Mis apps → Crear app → Otro → Empresa** → agrega el producto **WhatsApp**.
3. **Número**: WhatsApp → **Configuración de la API** → agrega el número de la clínica (no puede estar activo en la app de
   WhatsApp normal: hay que migrarlo o usar un número nuevo). Copia el **Identificador del número de teléfono** → `WHATSAPP_PHONE_NUMBER_ID`.
4. **Token permanente**: business.facebook.com → **Configuración del negocio → Usuarios del sistema → Agregar** (rol Administrador)
   → **Asignar activos** (la app y la cuenta de WhatsApp) → **Generar token** con los permisos `whatsapp_business_messaging`
   y `whatsapp_business_management`, caducidad **Nunca** → `WHATSAPP_TOKEN`.
   (El token temporal de la página de la API dura 24 horas: no lo uses en producción).
5. **Clave secreta de la app**: tu app → **Configuración → Básica → Clave secreta** → `WHATSAPP_APP_SECRET`.
6. **Webhook**: WhatsApp → **Configuración** → Webhook → **Editar**:
   - URL de devolución de llamada: `TU-URL/webhook`
   - Token de verificación: el mismo texto que pusiste en `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
   - **Verificar y guardar**. Luego, en "Campos del webhook", **Suscribirse** a **`messages`**.
7. **Plantillas** (recordatorios, retoma, reseña, resumen): WhatsApp → **Plantillas de mensajes** → crea las 5 de
   `docs/whatsapp-templates.md` con el mismo nombre, idioma **Español** y categoría **Utilidad**. Meta las aprueba en minutos u horas.
8. **Método de pago**: Configuración del negocio → **Pagos** → agrega la tarjeta **de la clínica** (las plantillas se cobran por conversación).

## 4. cron-job.org (despertador y tareas automáticas)

Render gratis **apaga el servicio tras 15 minutos sin visitas** y tarda casi un minuto en despertar. Estas tareas lo mantienen
despierto y disparan los recordatorios y reportes.

1. Crea una cuenta en <https://cron-job.org> → **Create cronjob** (una vez por cada fila de la tabla).
2. En cada una: **URL**, **Execution schedule** según la tabla, y en la pestaña **Advanced**:
   - **Request method**: GET o POST según la tabla.
   - **Headers** → *Add*: nombre `x-cron-secret`, valor = tu `CRON_SECRET` (en todas menos `/health`).
   - **Time zone**: `UTC` (así los horarios de la tabla son exactos; 13:00 UTC = 8:00 a. m. de Lima).
   - Activa **Notify me on failure** para enterarte si algo se cae.

| # | Método | URL | Header | Horario | Para qué |
|---|---|---|---|---|---|
| 1 | GET | `TU-URL/health` | — | Cada 10 minutos | Evita que Render se duerma (lo apaga a los 15 min sin tráfico) |
| 2 | POST | `TU-URL/jobs/reminders` | `x-cron-secret` | Cada 15 minutos | Recordatorios 24 h y 2 h antes de cada cita |
| 3 | POST | `TU-URL/jobs/follow-ups` | `x-cron-secret` | Cada hora (minuto 0) | Un solo mensaje de retoma a quien no agendó |
| 4 | POST | `TU-URL/jobs/daily-summary` | `x-cron-secret` | Todos los días, 13:00 UTC | Resumen diario al dueño a las 8:00 a. m. de Lima |
| 5 | POST | `TU-URL/jobs/weekly-report` | `x-cron-secret` | Lunes, 13:00 UTC | Reporte semanal y línea de la garantía |
| 6 | GET | `TU-URL/health/deep` | `x-cron-secret` | Cada 12 horas | Consulta la base de datos: Supabase gratis no se pausa y te avisa si se cae |

3. En cada tarea usa **Test run** (o "Run now"): debe responder `200` con `"ok":true`. Si responde `401`, el header
   `x-cron-secret` no coincide con `CRON_SECRET`; si responde `503`, falta `CRON_SECRET` en Render.

## 5. Checklist final

- [ ] En tu computadora: `npm run preflight` → todo en ✅ (usa las mismas variables que Render).
- [ ] `TU-URL/health` responde `{"status":"ok"}`.
- [ ] Meta: webhook **verificado** y suscrito a `messages`; las 5 plantillas en estado **Aprobada**.
- [ ] Desde un celular que no sea el de la clínica, escribe "hola" al WhatsApp de la clínica → llega la bienvenida con el logo.
- [ ] Pide una cita ("quiero una cita de limpieza") → llegan 3 horarios → responde "1" y tu nombre → recepción recibe la alerta
      "🦷 Nueva solicitud de cita".
- [ ] Escribe "tengo mucho dolor y la cara hinchada" → el bot deriva y recepción recibe "🚨 URGENCIA".
- [ ] Entra a `TU-URL/panel` con `PANEL_USER` / `PANEL_PASSWORD` → ves la conversación, la cita en **Agenda** y reactivas
      el bot en la conversación de la urgencia.
- [ ] cron-job.org: las 6 tareas creadas, con **Test run** en `200`.
- [ ] Al día siguiente a las 8:00 a. m.: el dueño recibió el resumen diario.

Si algo falla, `npm run preflight` dice qué falta y cómo arreglarlo, sin mostrar ninguna clave.
