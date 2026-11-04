# Varias clínicas: hoy (una instalación por clínica) y después (una instalación para todas)

Estado al 4 de noviembre de 2026 (rama `mejora/recepcionista-experta`). La parte (a) se puede usar hoy mismo;
la parte (b) es solo diseño: **no está implementada**.

---

## (a) Instalar la clínica N° 2 en menos de 1 hora (con lo que ya existe)

Hoy cada clínica es: **su archivo** `config/clinics/<id>.js` + **su número de WhatsApp** + **su servicio en Render**
+ **su proyecto de Supabase**. El código es el mismo repositorio; cambia solo la configuración.

> **Por qué un Supabase propio por clínica:** varias tablas no tienen `clinic_id` (`messages`, `conversations`,
> `chat_sessions`, `webhook_events`, `whatsapp_media_sends`) y la bandeja del panel no filtra por clínica. Con una
> base compartida, recepción de la clínica 2 vería los chats de la clínica 1. Hasta implementar la parte (b):
> **una base por clínica, sin excepciones.** (Revisa en tu plan de Supabase cuántos proyectos gratis te permite
> tener activos; si no alcanza, crea otra organización o pasa a un plan pago.)

### Antes de la llamada con la clínica (pídeselo por escrito)

- [ ] Nombre comercial, dirección exacta, referencia para llegar, enlace de Google Maps y, si quieres el mensaje de
      ubicación, latitud y longitud (Google Maps → clic derecho en el pin → copiar coordenadas).
- [ ] Horario por día, feriados en que cierran, tratamientos con precio "desde" y financiamiento, campaña vigente,
      formas de pago reales, 4-6 preguntas frecuentes.
- [ ] Tres números: el de la clínica (`CLINIC_PHONE`), el de recepción que recibe las alertas
      (`RECEPTION_ALERT_PHONE`) y el del dueño que recibe el briefing y el reporte (`OWNER_ALERT_PHONE`).
- [ ] Logo y fotos (solo con consentimiento escrito si son de pacientes; si no, ilustraciones — regla 12).
- [ ] Acceso al Business Manager de Meta de la clínica (o que te agreguen como socio) y el número que usará el bot,
      **sin** WhatsApp instalado en un celular.

### Checklist (≈ 55 min)

| # | Paso | Comando / dónde | Tiempo | Listo cuando |
|---|---|---|---|---|
| 1 | Rama de trabajo | `git checkout -b clinica/<id>` | 1 min | — |
| 2 | Generar la clínica | `npm run new-clinic -- <id> "<Nombre>"` → crea `config/clinics/<id>.js` (con `TODO`) y `media/<id>/` | 1 min | Existe el archivo |
| 3 | Completar los datos | Reemplaza cada `TODO` con lo que pediste; agrega `addressReference`, `latitude`/`longitude` y `paymentMethods` si los tienes | 15 min | `ACTIVE_CLINIC=<id> node -e "import('./config/clinic.config.js')"` no muestra errores (dice qué campo falta) |
| 4 | Imágenes | Pon las fotos en `media/<id>/` con los nombres de `media: {...}`, o `pwsh scripts/generate-demo-media.ps1 -ClinicId <id> -ClinicName "<Nombre>"` | 5 min | Cada clave de `media` tiene archivo |
| 5 | Probar en local | `npm run test:unit` (con la clínica demo, debe seguir en verde) y `ACTIVE_CLINIC=<id> npm run demo` → Probador del panel | 5 min | Tests en verde; el Probador responde con los datos de la clínica nueva |
| 6 | Supabase nuevo | Crea el proyecto → `npm run db:print` y pega en el SQL Editor cada "PEGA N° X", en orden (o `npm run db:migrate -- --apply` con `SUPABASE_DB_URL`) | 8 min | `npm run preflight` muestra las tablas en ✅ |
| 7 | Servicio en Render | New → Blueprint con este repo (usa `render.yaml`), rama de la clínica. Variables: `ACTIVE_CLINIC=<id>` + los 3 teléfonos + las de WhatsApp, Gemini y Supabase de **esta** clínica (lista completa en `.env.example`) | 8 min | `TU-URL/health` responde `ok` |
| 8 | Meta | `npm run meta:check` → `npm run meta:subscribe -- --apply` → `npm run meta:templates -- --apply`. En Meta → Webhook: `TU-URL/webhook` y el `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | 7 min | `meta:check` en ✅; plantillas "en revisión" |
| 9 | Crons | `PUBLIC_BASE_URL=TU-URL npm run crons:setup -- --apply` (las tareas se nombran `<id> · <tarea>`, no pisan las de otra clínica) | 2 min | cron-job.org muestra las 6 tareas de `<id>`; "Test run" = 200 |
| 10 | Prueba final | `npm run preflight` y `npm run smoke:prod -- TU-URL`; escribe desde tu celular: precio, "¿dónde quedan?" y una cita | 3 min | Todo en ✅ y la alerta llegó a recepción |

Notas:
- **Gemini:** puede usar la misma clave para varias clínicas, pero la cuota se comparte; con más de 2-3 clínicas
  activas conviene una clave por clínica (`npm run gemini:probe` mide los modelos con esa clave).
- **Render:** el plan gratis duerme el servicio y comparte las horas del mes entre servicios de la cuenta; desde el
  2.º cliente conviene el plan Starter (ya lo dice `render.yaml`).
- **Código:** el cambio que haga una clínica (texto, precios) va en su archivo de configuración o en el panel,
  nunca en controladores ni servicios (regla 3). Las mejoras del producto se hacen en `main` y cada rama de
  clínica se actualiza con `git merge main`.

---

## (b) Diseño: UNA instalación para muchas clínicas (no implementado)

### Objetivo
Un solo servicio y una sola base atienden N clínicas: dar de alta una clínica es una fila en la base (y su
número en Meta), no un servicio nuevo. Menos costo por clínica, un solo deploy y un panel con selector de clínica.

### Piezas

1. **Tabla `clinics`** (ya existe una tabla `clinics` heredada en `20260801_base_leads_messages.sql`; se amplía):
   `id TEXT PK`, `name`, `config JSONB` (lo mismo que hoy está en `config/clinics/<id>.js`, validado con
   `validateClinic` al guardar), `whatsapp_phone_number_id TEXT UNIQUE`, `waba_id`, teléfonos de alerta,
   `active BOOLEAN`, `created_at`. Los secretos (token de WhatsApp por clínica si no se usa un token de sistema
   común) van en Supabase Vault o en variables de entorno referenciadas por nombre, **nunca** en `config`.
2. **Ruteo por `phone_number_id`:** cada webhook de Meta trae `entry[].changes[].value.metadata.phone_number_id`
   (hoy ya se lee en `receiveMessage` → `context.phoneNumberId`). Un middleware resuelve la clínica con un caché
   en memoria con vencimiento (`createExpiringMap`) y la pasa por `AsyncLocalStorage` (el mismo patrón que
   `services/testContext.js`) a todo el flujo. Un `phone_number_id` desconocido se registra y se ignora.
3. **Clínica por contexto, no global:** hoy `config/clinic.config.js` exporta un objeto `clinic` único. Se
   reemplaza por `currentClinic()` (lee el contexto) en los servicios; las fábricas `create*({ clinic })` ya lo
   aceptan como parámetro, así que el cambio es mecánico pero toca casi todos los archivos.
4. **Aislamiento por `clinic_id`:** agregar `clinic_id NOT NULL` + índice a `messages`, `conversations`,
   `chat_sessions`, `webhook_events`, `whatsapp_media_sends` y `leads` (ya la tiene, sin usarla en las consultas).
   Cambiar las claves únicas a `(clinic_id, phone)` / `(clinic_id, conversation_id)`. Toda consulta filtra por
   `clinic_id`; como red de seguridad, **RLS** con una política por `clinic_id` y un cliente de Supabase por
   petición con el `clinic_id` en un claim (el service role salta RLS, así que el filtro en código es obligatorio).
5. **Envío por clínica:** `whatsappService` recibe `phoneNumberId` y token de la clínica del contexto (hoy salen de
   `config/env.js`). Las plantillas se aprueban por WABA: guardar en `clinics` qué plantillas tiene aprobadas.
6. **Jobs:** cada `POST /jobs/*` recorre las clínicas activas (o recibe `?clinic=<id>`), con un tope de tiempo por
   clínica para no pasar el timeout de cron-job.org (30 s): con muchas clínicas, una tarea por clínica.
7. **Panel:** usuarios en una tabla `panel_users (email, clinic_id, rol)` en vez de `PANEL_USER`/`PANEL_PASSWORD`;
   el dueño de varias sedes ve un selector. Las sesiones en memoria (`geminiService`, cachés) pasan a clave
   `clinic_id:phone`.
8. **Migración de los clientes actuales:** script que copia cada `config/clinics/<id>.js` a `clinics.config` y,
   por cada base de Supabase existente, exporta sus filas agregando `clinic_id`. Se hace clínica por clínica, con
   la instalación vieja en paralelo hasta validar.

### Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Fuga de datos entre clínicas (una consulta sin `clinic_id`) | Crítico: datos de pacientes (Ley 29733) | Filtro obligatorio en un repositorio por tabla + RLS + test que recorre cada servicio con 2 clínicas y verifica que no se cruzan |
| Un `clinic` global olvidado en algún servicio | Respuestas con datos de otra clínica | Eliminar el export global (que falle al importar) en vez de convivir con él |
| Cuota de Gemini compartida | Una clínica con mucho tráfico deja sin IA a las demás | Clave por clínica o límite por clínica; la respuesta sin IA (`quickAnswers`) ya cubre las preguntas comunes |
| Un deploy roto afecta a todas | Todas las clínicas caídas a la vez | Rama de staging + `npm run smoke:prod` antes de `main`; Render con deploy manual en horario de baja demanda |
| Jobs más lentos con N clínicas | Recordatorios tarde | Una tarea de cron por clínica o procesamiento por lotes con tope de tiempo |
| Tokens de Meta por clínica | Un token vencido corta a una sola clínica sin que se note | `systemAlerts` por clínica y banner en su panel |

### Estimación

| Bloque | Días de trabajo |
|---|---|
| Tabla `clinics`, ruteo por `phone_number_id` y contexto por petición | 2 |
| Reemplazar el `clinic` global en servicios, controladores y panel | 2-3 |
| `clinic_id` en todas las tablas, claves únicas, filtros y RLS + tests de aislamiento | 2-3 |
| WhatsApp/plantillas por clínica, jobs por clínica | 1-2 |
| Usuarios del panel por clínica | 1-2 |
| Migración de clientes actuales y prueba en paralelo | 1-2 |
| **Total** | **≈ 9-14 días** (una persona, con tests) |

Recomendación: mantener (a) hasta tener 4-5 clínicas pagando; ahí el costo de operar N servicios supera el de
hacer (b) una vez.
