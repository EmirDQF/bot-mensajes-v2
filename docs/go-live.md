# Go-live en 1 página (≈ 75 min + la espera de Meta)

Sigue los pasos **en orden**. Cada comando se corre en la carpeta del bot (terminal de VS Code). Ninguno muestra tus
claves. Los que cambian algo son **--dry-run** por defecto: primero muestran qué harían y solo lo hacen con `--apply`.
Detalle de cada servicio: [docs/deploy.md](deploy.md).

| # | Paso | Tiempo | Listo cuando… |
|---|---|---|---|
| 1 | **Claves en `.env` y en Render** (ver "Dónde sale cada clave" abajo) → `npm run preflight` | 20 min | Solo quedan ⚠️ de lo que aún no existe (URL de Render) |
| 2 | **`git push`** de la rama aprobada a `main` (lo hace el dueño del repo) | 1 min | GitHub muestra el último commit |
| 3 | **Render → New → Blueprint** → el repositorio → pega los valores → **Apply** | 10 min | `TU-URL/health` dice `{"status":"ok"}` |
| 4 | **Base de datos:** `npm run db:print` → pega cada "PEGA N° X" en Supabase → SQL Editor → Run (o `npm run db:migrate -- --apply` con `SUPABASE_DB_URL`) | 5 min | `npm run db:print` dice "No hay nada que pegar" |
| 5 | **Webhook en Meta** (única parte a mano): developers.facebook.com → tu app → WhatsApp → **Configuración** → Webhook → Editar: URL `TU-URL/webhook` + tu `WHATSAPP_WEBHOOK_VERIFY_TOKEN` → **Verificar y guardar** → Campos → **Suscribirse** a `messages` | 3 min | Meta muestra ✔ verificado |
| 6 | `npm run meta:subscribe` → `npm run meta:subscribe -- --apply` | 1 min | "App suscrita al WABA" |
| 7 | `npm run meta:templates` → `npm run meta:templates -- --apply` | 2 min + espera de Meta (minutos a 24 h) | `npm run meta:check`: plantillas en APPROVED |
| 8 | Pon `PUBLIC_BASE_URL=TU-URL` en tu `.env` → `npm run crons:setup` → `npm run crons:setup -- --apply` (sin `CRONJOB_API_KEY` imprime la tabla para crearlas a mano: 10 min) | 2 min | cron-job.org muestra 6 tareas; "Test run" = 200 |
| 9 | `npm run smoke:prod -- TU-URL` → `npm run smoke:prod -- TU-URL --apply` | 2 min | Todo ✅ y te llega "Hello World" al WhatsApp del dueño |
| 10 | **Prueba real:** desde TU celular escribe "hola" al número del bot y abre `TU-URL/panel` | 5 min | Ves el mensaje entrar **en vivo** en la Bandeja y la respuesta del bot |

**TU-URL** = la dirección que te da Render, por ejemplo `https://asistente-dental.onrender.com` (sin `/` al final).

## Dónde sale cada clave

- **`WHATSAPP_TOKEN` PERMANENTE** (el de "Configuración de la API" vence a las 24 h y el bot deja de responder):
  business.facebook.com → **Configuración del negocio → Usuarios → Usuarios del sistema → Agregar** (nombre "bot",
  rol **Administrador**) → **Asignar activos**: tu **app** y tu **cuenta de WhatsApp** con control total →
  **Generar token** → app: la tuya · caducidad: **Nunca** · permisos: `whatsapp_business_messaging` y
  `whatsapp_business_management` → copia el token (solo se muestra una vez). `npm run meta:check` debe decir **PERMANENTE**.
- **`WHATSAPP_PHONE_NUMBER_ID`** y **`WHATSAPP_BUSINESS_ACCOUNT_ID`** (WABA_ID): developers.facebook.com → tu app →
  WhatsApp → **Configuración de la API**: "Identificador del número de teléfono" e "Identificador de la cuenta de
  WhatsApp Business". Son números largos; no es el número de teléfono.
- **`WHATSAPP_APP_SECRET`**: tu app → **Configuración → Básica** → "Clave secreta de la app" → Mostrar.
- **`WHATSAPP_WEBHOOK_VERIFY_TOKEN`**: inventa una frase larga; la misma va en el paso 5.
- **Teléfonos** (`CLINIC_PHONE`, `RECEPTION_ALERT_PHONE`, `OWNER_ALERT_PHONE`): solo dígitos con código de país, sin `+`
  ni espacios: **`51XXXXXXXXX`** (ej. `51987654321`).
- **Supabase**: Project Settings → API → Project URL (`https://xxxx.supabase.co`, **sin** `/rest/v1`) y service_role.
- **Gemini**: <https://aistudio.google.com/apikey> → Crear clave.
- **`CRON_SECRET`**: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
- **Panel**: `PANEL_USER`/`PANEL_PASSWORD` (recepción) y `PANEL_OWNER_USER`/`PANEL_OWNER_PASSWORD` (dueño), 12+ caracteres.
- Opcionales, **solo en tu `.env`**: `CRONJOB_API_KEY` (cron-job.org → Settings → API) y `SUPABASE_DB_URL`
  (Supabase → Connect → URI, *Session pooler*).

## Antes de usar el número REAL de la clínica

- El número del bot **no puede seguir activo en la app de WhatsApp del celular**. Si la clínica ya lo usa, primero
  **elimina la cuenta** en la app (Ajustes → Cuenta → Eliminar cuenta) o usa un número nuevo. Lo que haya en ese
  WhatsApp no pasa al bot.
- Agrégalo en WhatsApp → Configuración de la API → **Agregar número**, verifica con el código SMS y regístralo en Cloud
  API con un PIN de 6 dígitos (`npm run meta:check` avisa si falta "Registrado en Cloud API").
- **Verifica el negocio** (Configuración del negocio → Centro de seguridad → Verificación, con RUC): sin verificación Meta
  limita las conversaciones que inicia la clínica (plantillas) a 250 por día.
- Agrega la **tarjeta de la clínica** en Configuración del negocio → Pagos: las plantillas las cobra Meta a la clínica.

Con el **número de prueba** de Meta todo funciona igual, pero solo escribe a los 5 números de la lista "Para"
(Configuración de la API): agrega ahí tu celular, el de recepción y el del dueño.

## Si algo falla

- `npm run preflight` y `npm run meta:check` dicen qué falta y cómo arreglarlo.
- **Banner rojo "TOKEN DE WHATSAPP VENCIDO"** en el panel: genera el token permanente (arriba), cámbialo en Render →
  Environment → Save (se reinicia solo) y en tu `.env`.
- El bot no responde: Render → Logs. Si ves la firma rechazada, `WHATSAPP_APP_SECRET` no es el de tu app.
