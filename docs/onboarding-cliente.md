# Instalar una clínica nueva (menos de 1 hora)

Guía para pasar de "el director dijo que sí" a "el asistente atiende su WhatsApp", con prueba en vivo y la semana
de garantía bien medida. Complementa `docs/deploy.md` (infraestructura) y `CLAUDE.md` (código).

---

## 1. Qué le pido a la clínica (antes de la instalación)

Mándalo por WhatsApp o correo apenas cierres. Sin estos datos no se instala.

| # | Qué | Detalle |
|---|---|---|
| 1 | **Logo** | PNG o JPG cuadrado, fondo sólido. |
| 2 | **Fotos propias** | Fachada, recepción o consultorio. Fotos de pacientes (antes/después) **solo con consentimiento escrito del paciente**, firmado y guardado por la clínica. Si no hay consentimiento o no hay fotos, se usan ilustraciones de la clínica (marcadas como "Imagen referencial"). |
| 3 | **Precios "desde"** | Uno por tratamiento que ofrecen (ortodoncia, implantes, limpieza…) y cómo se pagan (cuota inicial, cuotas, pago único). El bot solo dice estos precios; el costo exacto se define en la evaluación. |
| 4 | **Campaña del mes** | Solo lo que de verdad ofrecen (ej. evaluación sin costo, cuota inicial S/ 0). El bot no inventa descuentos. |
| 5 | **Horario** | Por día, con hora de apertura y cierre, y si hay refrigerio. Días cerrados. |
| 6 | **Dirección y enlace de Google Maps** | Maps → Compartir → Copiar enlace. |
| 7 | **Número de WhatsApp** | El que sale en sus anuncios. Debe pasar a WhatsApp Business API (deja de funcionar en la app normal) o usar un número nuevo para el bot. |
| 8 | **Meta Business verificado** | Cuenta en business.facebook.com con la empresa verificada (RUC y documentos). Si no está verificada, empezar el trámite hoy: puede tomar días. |
| 9 | **Tarjeta en Meta** | Método de pago **de la clínica** en Meta Business → Pagos. Meta cobra las plantillas (recordatorios fuera de la ventana de 24 h). |
| 10 | **Quién recibe las alertas** | Celular de **recepción** (citas nuevas, urgencias, pases a humano) y del **dueño/director** (resumen diario y reporte semanal). |
| 11 | **Preguntas frecuentes** | Medios de pago (Yape, Plin, tarjeta), estacionamiento, si atienden niños, si la evaluación tiene costo. |
| 12 | **Opcional** | Enlace para dejar reseña en Google (se pide automáticamente cuando recepción marca "Asistió") y su calificación real en Google con el número de reseñas. |
| 13 | **Pack de evaluación** | Qué incluye la primera visita, su precio y, si hay, la promoción con su fecha de fin. |
| 14 | **Imágenes por tratamiento** | Las que quieren mostrar (comparaciones, antes/después **solo con consentimiento escrito**). JPG, PNG o WebP de hasta 2 MB. |
| 15 | **Especialistas** | Solo nombres de quienes atienden de verdad en la clínica, y qué tratamientos ve cada uno (opcional: sale en el pase de cita). |
| 16 | **Celular del doctor** | Opcional: recibe la ficha de cada cita nueva (`DOCTOR_ALERT_PHONE`). |
| 17 | **Cómo agendan hoy** | Si la Agenda del panel será su ÚNICA agenda se puede usar *confirmación directa*; si también agendan en un cuaderno o Excel, se queda en *solicitud* (recepción confirma). |

## 2. Orden de instalación (≈ 55 min)

| Paso | Tiempo | Qué hacer |
|---|---|---|
| 1 | 10 min | (Opcional: también se puede completar todo después en el panel → **🏥 Mi clínica**.) `npm run new-clinic -- <id> "<Nombre>"` (ej. `sonrisa-surco "Clínica Dental Sonrisa"`). Completa cada `TODO` de `config/clinics/<id>.js` con los datos del punto 1. El bot **no arranca** mientras quede algún TODO y el error dice cuáles faltan. |
| 2 | 5 min | Imágenes en `media/<id>/` con los nombres de `media: {...}`. Sin fotos propias: `pwsh scripts/generate-demo-media.ps1 -ClinicId <id> -ClinicName "<Nombre>" -ShortName "<MARCA>" -AddressLine "<dirección corta>" -AddressNote "" -Footnote "Imagen referencial"`. |
| 3 | 10 min | **Supabase**: un proyecto por clínica (sus datos no se mezclan con los de otra). `npm run db:print` y pega cada "PEGA N° X" en el SQL Editor (o `npm run db:migrate -- --apply`). |
| 4 | 10 min | **Render**: Blueprint con `ACTIVE_CLINIC=<id>` y los 3 teléfonos (`docs/deploy.md`, paso 1). |
| 5 | 10 min | **Meta**: token permanente (`npm run meta:check` → PERMANENTE), webhook a `TU-URL/webhook` + campo `messages` (a mano, una vez), `npm run meta:subscribe -- --apply` y `npm run meta:templates -- --apply` (`docs/go-live.md`, pasos 5-7). |
| 6 | 2 min | **cron-job.org**: `npm run crons:setup -- --apply` (o la tabla a mano, `docs/deploy.md`, paso 4). |
| 7 | 5 min | `npm run preflight` y `npm run smoke:prod -- TU-URL --apply` → todo en ✅. |
| 8 | 15 min | Panel → **🏥 Mi clínica** con el dueño: datos, horario con refrigerio, tratamientos e imágenes, pack, promociones, preguntas frecuentes y el modo de agendamiento. El indicador **"Configuración completa: X de Y"** debe quedar completo. Checklist: `docs/onboarding-cliente.md` § 6. |

## 3. Prueba en vivo con el dueño (15–20 min, el día de la conexión)

Hazla con el dueño o el director al lado, desde **su** celular (no el de recepción) y con el panel abierto en tu laptop.

1. Escribe "hola" → llega la bienvenida con el logo y el aviso de privacidad.
2. "¿Cuánto cuestan los brackets?" → responde con **su** precio "desde" y envía la imagen.
3. "Quiero una cita el sábado" → ofrece horarios reales **en botones** → toca uno y da su nombre → recepción (y el
   doctor, si configuraste su número) recibe la ficha de la cita. Si la clínica usa confirmación directa, llega el
   **pase de cita**. Después el bot pregunta una sola vez si quiere recibir promociones. Muéstrale la cita en **Agenda**.
4. "Tengo mucho dolor y la cara hinchada" → el bot deriva, se pausa y recepción recibe "🚨 URGENCIA".
   En el panel, **reactiva el bot** en esa conversación.
5. Explícale a recepción los botones de la agenda: **Confirmar** (después de hablar con el paciente), **Asistió**,
   **No asistió**, **Cancelar**. Estos botones son los que alimentan el reporte y la garantía.
6. **Cancela las citas de prueba** en el panel. Además, el reporte no cuenta las citas pedidas desde los
   teléfonos de recepción o del dueño.
7. Anota la fecha y hora de conexión: es el **día 0** de la garantía.

## 4. Semana de garantía (días 0 a 6)

**La oferta:** S/ 400 al conectar + S/ 400 si en 7 días el sistema genera **al menos 2 citas de evaluación
confirmadas**. Si no se cumple, se devuelven los S/ 400.

**Qué se mide (sin interpretación):** el reporte del sistema para el rango día 0 → día 6.

- **Cuenta** una cita si la pidió un paciente por el asistente en esos 7 días **y** recepción la marcó
  **Confirmar** o **Asistió** en el panel, o el paciente respondió "1 / Confirmo" al recordatorio.
- **No cuenta:** citas canceladas (aunque se hayan confirmado antes), citas pedidas desde los teléfonos de
  recepción o del dueño, y citas agendadas por teléfono u otro canal fuera del asistente.
- **Umbral:** 2 (variable `GUARANTEE_MIN_CONFIRMED`). La línea del reporte lo dice sola:
  `Citas de evaluación confirmadas: N / meta 2 → ✅ cumplido` o `⏳ pendiente`.

**Durante la semana:**

- Día 1 a las 8:00 a. m.: el dueño recibe el primer resumen diario (incluye "🌙 Citas solicitadas mientras
  la clínica estaba cerrada").
- Día 3: revisa el panel → **Reporte** (rango día 0 → hoy). Si hay citas sin confirmar, recuérdale a recepción
  que llame a esos pacientes y use el botón **Confirmar**.
- Día 7: panel → **Reporte** → rango día 0 → día 6 → **Imprimir / PDF** y envíaselo al director. También puedes
  mandárselo por WhatsApp: `POST TU-URL/jobs/weekly-report?from=AAAA-MM-DD&to=AAAA-MM-DD` con el header
  `x-cron-secret` (desde cron-job.org → *Test run*, o con curl).
  - ✅ **cumplido** → cobra los S/ 400 restantes y ofrece el mantenimiento mensual.
  - ⏳ **pendiente** → devuelve los S/ 400 como dice el acuerdo, y conversa qué faltó (¿se pautaron anuncios?
    ¿recepción confirmó en el panel?).

## 5. Después de la garantía

- Cada lunes 8:00 a. m. el dueño recibe el reporte semanal (tarea 5 de cron-job.org).
- Si cambian precios, horario, imágenes o promociones: el dueño lo hace en el panel → **🏥 Mi clínica** (con
  "Deshacer el último cambio" si se equivoca). El archivo `config/clinics/<id>.js` queda como respaldo.
- Promociones a pacientes anteriores: pestaña **📣 Campañas** (solo llegan a quien dio permiso; máximo una cada 14 días).
- Si un paciente pide borrar sus datos: puede escribir "borrar mis datos" al WhatsApp de la clínica y el bot
  los elimina (las citas se conservan para su atención). Si lo pide por otro canal, pídele que escriba esa frase.

## 6. Instalar con el panel en 15 minutos (checklist)

Con el servicio ya desplegado (Render, Supabase con las migraciones, Meta y cron-job.org listos) y el dueño al lado:

1. **(1 min)** Entra a `TU-URL/panel` como dueño → **🏥 Mi clínica**. Mira el indicador "Configuración completa".
2. **(3 min) Datos:** nombre, dirección, referencia, enlace de Maps (y coordenadas), reseñas y calificación de Google
   (solo la real), logo y colores. **Guardar**.
3. **(2 min) Horario:** días, apertura y cierre, refrigerio, feriados y duración de la cita → **Generar texto** → **Guardar**.
4. **(4 min) Tratamientos:** precio "desde", financiamiento, duración, cómo lo llaman los pacientes, especialista e
   imágenes del catálogo (sube, ordena y escribe el texto de cada una). Borra los que no ofrecen. **Guardar**.
5. **(2 min) Pack de evaluación** (usa **Actualizar vista previa**) y **Promociones** con fecha de inicio y de fin. **Guardar**.
6. **(1 min) Medios de pago y preguntas frecuentes** (al menos 3). **Guardar**.
7. **(1 min) Asistente:** nombre, tono, modo de agendamiento (lee la advertencia), recordatorios y seguimiento. **Guardar**.
8. **(1 min)** El indicador debe decir **"✅ Configuración completa"**. Si falta algo de "Render → Environment", corrígelo
   ahí. Luego **🧪 Probar** → "hola", "cuánto cuestan los brackets", "quiero una cita" y toca un horario.
