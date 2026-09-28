# Puesta en producción (24/7, costo 0 para el primer cliente)

Guía de referencia para dejar el asistente atendiendo WhatsApp las 24 horas. No hace falta programar:
solo copiar y pegar valores. **¿Quieres salir hoy? Sigue [docs/go-live.md](go-live.md)** (checklist de 1 página con
tiempos); aquí está el detalle de cada servicio. Casi todo se hace con scripts (`npm run db:print`, `meta:subscribe`,
`meta:templates`, `crons:setup`, `smoke:prod`): todos son **--dry-run por defecto** y solo cambian algo con `--apply`.

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
   | `GEMINI_API_KEY` | Clave de <https://aistudio.google.com/apikey> (el preflight la valida con una llamada real) |
   | `GEMINI_MODEL` | `gemini-3.5-flash-lite` |
   | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Del paso 3 (Meta) |
   | `ENFORCE_WHATSAPP_SIGNATURE` | Ya viene en `true` en `render.yaml` |
   | `NODE_ENV`, `PANEL_SESSION_SECRET` | Los pone `render.yaml` solo (`production` y un valor aleatorio) |
   | `WHATSAPP_API_VERSION` | `v21.0` |
   | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Del paso 2 (Supabase) |
   | `PANEL_USER`, `PANEL_PASSWORD` | Usuario y contraseña (12+ caracteres) de **recepción**: Bandeja, Agenda, Métricas y Reporte |
   | `PANEL_OWNER_USER`, `PANEL_OWNER_PASSWORD` | Usuario y contraseña del **dueño** (distintos): además ⚙️ Configuración y 🧪 Probador |
   | `CRON_SECRET` | Una clave larga al azar. Genérala con: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
   | `PUBLIC_BASE_URL` | Déjala vacía en Render (usa `RENDER_EXTERNAL_URL`). En tu `.env` local pon **TU-URL**: la usan `crons:setup` y `smoke:prod` |
   | El resto (`APPOINTMENT_MIN_LEAD_MINUTES`, `FOLLOW_UP_AFTER_HOURS`, `WA_TEMPLATE_*`) | Los valores de `.env.example` |

4. **Apply**. Cuando termine, copia la dirección del servicio (ej. `https://asistente-dental.onrender.com`).
   En esta guía la llamamos **TU-URL**.
5. Prueba: abre `TU-URL/health` en el navegador. Debe decir `{"status":"ok",...}`.

> Si luego cambias una variable: Render → tu servicio → **Environment** → editar → **Save changes** (se reinicia solo).

## 2. Supabase (la base de datos)

1. Entra a <https://supabase.com/dashboard> → **New project**. Región: **South America (São Paulo)** (la más cercana a Lima).
   Guarda la contraseña de la base de datos en un lugar seguro.
2. Con `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` en tu `.env` (paso 3), corre **`npm run db:print`**: detecta qué
   tablas y columnas faltan e imprime solo ese SQL, en orden, en bloques **"PEGA N° 1 de N"**. En Supabase →
   **SQL Editor** → **New query**: pega cada bloque, **Run**, espera "Success" y sigue con el siguiente. Vuelve a correr
   `npm run db:print` hasta que diga "No hay nada que pegar".
   - **Alternativa sin copiar y pegar:** pon en tu `.env` (nunca en Render) `SUPABASE_DB_URL` = Supabase → **Connect** →
     Connection string → **URI** (modo *Session pooler*) y corre `npm run db:migrate` (muestra el plan) y luego
     `npm run db:migrate -- --apply` (las aplica y las anota en la tabla `schema_migrations`).
   - Todas las migraciones se pueden ejecutar más de una vez sin romper nada. `20260803_add_chatwoot_fields_to_clinics.sql`
     es histórica (el producto ya no usa Chatwoot): no hace daño.
3. **Project Settings → API**:
   - **Project URL** → es `SUPABASE_URL`. Debe verse así: `https://xxxx.supabase.co` (**sin** `/rest/v1` al final).
   - **service_role** (en "Project API keys", botón *Reveal*) → es `SUPABASE_SERVICE_ROLE_KEY`. Es secreta: solo va en Render.
4. Pon ambos valores en Render (paso 1) y en tu `.env` local.

## 3. Meta (WhatsApp de la clínica)

1. **Meta Business**: la clínica necesita una cuenta en <https://business.facebook.com> **verificada** (RUC y documentos).
   Sin verificación, Meta limita cuántas personas nuevas puede contactar la clínica por día.
2. **App**: <https://developers.facebook.com> → **Mis apps → Crear app → Otro → Empresa** → agrega el producto **WhatsApp**.
3. **Número**: WhatsApp → **Configuración de la API** → agrega el número de la clínica (no puede estar activo en la app de
   WhatsApp normal: hay que migrarlo o usar un número nuevo). Copia el **Identificador del número de teléfono** → `WHATSAPP_PHONE_NUMBER_ID`
   y el **Identificador de la cuenta de WhatsApp Business** → `WHATSAPP_BUSINESS_ACCOUNT_ID`.
4. **Token permanente**: business.facebook.com → **Configuración del negocio → Usuarios del sistema → Agregar** (rol Administrador)
   → **Asignar activos** (la app y la cuenta de WhatsApp) → **Generar token** con los permisos `whatsapp_business_messaging`
   y `whatsapp_business_management`, caducidad **Nunca** → `WHATSAPP_TOKEN`.
   (El token temporal de la página de la API dura 24 horas: no lo uses en producción). `npm run meta:check` dice si tu
   token es **PERMANENTE** o **TEMPORAL** y cuántas horas le quedan. Si vence, el bot deja de enviar, los logs de Render
   dicen `TOKEN DE WHATSAPP VENCIDO` y el panel muestra un banner rojo con estos mismos pasos.
5. **Clave secreta de la app**: tu app → **Configuración → Básica → Clave secreta** → `WHATSAPP_APP_SECRET`.
6. **Webhook**: WhatsApp → **Configuración** → Webhook → **Editar**:
   - URL de devolución de llamada: `TU-URL/webhook`
   - Token de verificación: el mismo texto que pusiste en `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
   - **Verificar y guardar**. Luego, en "Campos del webhook", **Suscribirse** a **`messages`**.
   - Esto es lo único que Meta no deja hacer por API: se hace **una vez** por app.
   - Después: `npm run meta:subscribe` (plan) y `npm run meta:subscribe -- --apply` suscribe la app a la cuenta de WhatsApp
     (sin esto Meta verifica el webhook pero **no envía los mensajes**).
7. **Plantillas**: `npm run meta:templates` muestra cuáles faltan y `npm run meta:templates -- --apply` envía a aprobación
   las 6 de `config/whatsappTemplates.js` (idioma `es`: Meta no ofrece `es_PE`), con ejemplos de la clínica activa. Las que ya
   existen se saltan. Recordatorios, resumen y reporte van como **Utilidad**; retoma y reseña como **Marketing** (Meta las
   reclasificaría). Meta responde en minutos u horas: `npm run meta:check` muestra el estado de cada una.
   Texto de referencia: `docs/whatsapp-templates.md`.
8. **Método de pago**: Configuración del negocio → **Pagos** → agrega la tarjeta **de la clínica** (las plantillas se cobran por conversación).

## 4. cron-job.org (despertador y tareas automáticas)

Render gratis **apaga el servicio tras 15 minutos sin visitas** y tarda casi un minuto en despertar. Estas tareas lo mantienen
despierto y disparan los recordatorios y reportes.

**Automático:** crea una clave en cron-job.org → **Settings → API** y ponla en tu `.env` como `CRONJOB_API_KEY` (junto con
`PUBLIC_BASE_URL` = TU-URL). `npm run crons:setup` muestra el plan y `npm run crons:setup -- --apply` crea o actualiza las 6
tareas (se reconocen por el título `<clínica> · <tarea>`, así que correrlo dos veces no duplica nada).

**A mano** (sin `CRONJOB_API_KEY`, `npm run crons:setup` imprime esta misma tabla con tu URL):

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

## 5. Por qué el plan gratis funciona (y cuándo pasar a Starter)

- **Render gratis duerme** a los 15 minutos sin tráfico y tarda ~50 s en despertar. La tarea `/health` cada 10 minutos lo
  mantiene despierto las 24 h (744 h al mes, dentro de las 750 h gratis).
- **Si igual duerme** (por ejemplo, justo después de un deploy), el primer mensaje del paciente tarda en responderse, pero
  **no se pierde**: Meta reintenta el webhook si no recibe `200` a tiempo, y el bot deduplica por `message.id`, así que
  nunca responde dos veces.
- **Desde el 2.º cliente** conviene **Render Starter**: dos servicios gratis no entran en las 750 h, y Starter no duerme.

## 6. Checklist final

- [ ] En tu computadora: `npm run preflight` → todo en ✅ (usa las mismas variables que Render).
- [ ] `npm run smoke:prod -- TU-URL` → todo en ✅ (salud, firma del webhook, jobs y panel protegidos). Con `--apply`
      además envía la plantilla `hello_world` al `OWNER_ALERT_PHONE`.
- [ ] `TU-URL/health` responde `{"status":"ok"}`.
- [ ] Meta: webhook **verificado** y suscrito a `messages`; las 6 plantillas en estado **Aprobada**.
- [ ] Desde un celular que no sea el de la clínica, escribe "hola" al WhatsApp de la clínica → llega la bienvenida con el logo.
- [ ] Pide una cita ("quiero una cita de limpieza") → llegan 3 horarios → responde "1" y tu nombre → recepción recibe la alerta
      "🦷 Nueva solicitud de cita".
- [ ] Escribe "tengo mucho dolor y la cara hinchada" → el bot deriva y recepción recibe "🚨 URGENCIA".
- [ ] Entra a `TU-URL/panel` con `PANEL_USER` / `PANEL_PASSWORD` → ves la conversación, la cita en **Agenda** y reactivas
      el bot en la conversación de la urgencia.
- [ ] cron-job.org: las 6 tareas creadas, con **Test run** en `200`.
- [ ] Al día siguiente a las 8:00 a. m.: el dueño recibió el resumen diario.

Si algo falla, `npm run preflight` dice qué falta y cómo arreglarlo, sin mostrar ninguna clave.
